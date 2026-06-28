import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  type Focusable,
  getKeybindings,
  matchesKey,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { PermissionRequestPrompt } from "../api.js";

export type PermissionGateResult =
  | { kind: "allow"; note?: string }
  | { kind: "reject"; abort: boolean; note?: string };

type PermissionChoice = "yes" | "no";

type WrappedLine = {
  text: string;
  startIndex: number;
};

const CHOICES: PermissionChoice[] = ["yes", "no"];
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function padRight(content: string, width: number): string {
  return content + " ".repeat(Math.max(0, width - visibleWidth(content)));
}

function hint(theme: ExtensionContext["ui"]["theme"], key: string, description: string): string {
  return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
}

function wrapParagraphs(text: string, width: number): string[] {
  return text
    .split("\n")
    .flatMap((line) => (line ? wrapTextWithAnsi(line, Math.max(1, width)) : [""]));
}

function getNextGraphemeLength(text: string, index: number): number {
  const remaining = text.slice(index);
  const first = segmenter.segment(remaining)[Symbol.iterator]().next().value;
  return first?.segment.length ?? 1;
}

function getPreviousGraphemeLength(text: string, index: number): number {
  const before = text.slice(0, index);
  const parts = [...segmenter.segment(before)];
  return parts.at(-1)?.segment.length ?? 1;
}

function sanitizeDraftInput(text: string): string {
  return text
    .replaceAll("\x1b[200~", "")
    .replaceAll("\x1b[201~", "")
    .replace(/[\r\n]+/g, " ");
}

function wrapDraftText(text: string, width: number): WrappedLine[] {
  const maxWidth = Math.max(1, width);
  const lines: WrappedLine[] = [];
  let offset = 0;
  let remaining = text;

  while (remaining.length > 0) {
    if (visibleWidth(remaining) <= maxWidth) {
      lines.push({ text: remaining, startIndex: offset });
      break;
    }

    let currentWidth = 0;
    let breakIndex = -1;

    for (const part of segmenter.segment(remaining)) {
      const piece = part.segment;
      const pieceWidth = visibleWidth(piece);

      if (currentWidth + pieceWidth > maxWidth) {
        if (breakIndex !== -1) {
          lines.push({ text: remaining.slice(0, breakIndex).trimEnd(), startIndex: offset });
          const rest = remaining.slice(breakIndex).trimStart();
          offset += breakIndex;
          remaining = rest;
        } else {
          const line = remaining.slice(0, part.index) || piece;
          const consumed = remaining.slice(0, part.index) ? part.index : piece.length;
          lines.push({ text: line, startIndex: offset });
          offset += consumed;
          remaining = remaining.slice(consumed);
        }
        break;
      }

      currentWidth += pieceWidth;
      if (/\s/.test(piece)) {
        breakIndex = part.index + piece.length;
      }
    }
  }

  return lines.length > 0 ? lines : [{ text: "", startIndex: 0 }];
}

class PermissionPromptOverlay implements Focusable {
  focused = false;

  private selected: PermissionChoice = "yes";
  private editing = false;
  private tabUsed = false;
  private drafts: Record<PermissionChoice, string> = { yes: "", no: "" };
  private cursor = 0;

  constructor(
    private theme: ExtensionContext["ui"]["theme"],
    private name: string,
    private message: string,
    private requestPrompt: Required<Pick<PermissionRequestPrompt, "approveLabel" | "rejectLabel">>,
    private done: (result: PermissionGateResult) => void,
  ) {}

  invalidate(): void {}
  dispose(): void {}

  handleInput(data: string): void {
    if (this.isCancel(data)) {
      this.done({ kind: "reject", abort: true });
      return;
    }

    if (matchesKey(data, "shift+tab")) {
      this.editing = false;
      return;
    }

    if (this.editing) {
      this.handleEditingInput(data);
      return;
    }

    this.handleSelectionInput(data);
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 2);
    const bodyWidth = Math.max(1, innerWidth - 1);
    const border = (text: string) => this.theme.fg("border", text);
    const row = (content = "") => `${border("│")} ${padRight(content, bodyWidth)}${border("│")}`;

    return [
      border(`╭${"─".repeat(innerWidth)}╮`),
      row(this.theme.fg("accent", this.theme.bold(this.name))),
      row(),
      ...wrapParagraphs(this.message, bodyWidth).map((line) => row(line)),
      row(),
      ...this.renderOptions(bodyWidth).map((line) => row(line)),
      row(),
      row(this.renderLegend()),
      border(`╰${"─".repeat(innerWidth)}╯`),
    ];
  }

  private get currentDraft(): string {
    return this.drafts[this.selected];
  }

  private set currentDraft(value: string) {
    this.drafts[this.selected] = value;
  }

  private handleEditingInput(data: string): void {
    if (this.isUp(data, false)) {
      this.moveSelection("yes");
      return;
    }
    if (this.isDown(data, false)) {
      this.moveSelection("no");
      return;
    }
    if (this.isConfirm(data)) {
      this.commitSelection();
      return;
    }
    if (matchesKey(data, "tab")) return;
    this.handleDraftInput(data);
  }

  private handleSelectionInput(data: string): void {
    if (matchesKey(data, "tab")) {
      this.tabUsed = true;
      this.editing = true;
      this.cursor = this.currentDraft.length;
      return;
    }

    if (this.isUp(data)) {
      this.moveSelection("yes");
      return;
    }

    if (this.isDown(data)) {
      this.moveSelection("no");
      return;
    }

    if (matchesKey(data, "1")) {
      this.selectByNumber("yes");
      return;
    }

    if (matchesKey(data, "2")) {
      this.selectByNumber("no");
      return;
    }

    if (this.isConfirm(data)) {
      this.commitSelection();
    }
  }

  private selectByNumber(choice: PermissionChoice): void {
    if (this.tabUsed) {
      this.moveSelection(choice);
      return;
    }

    this.selected = choice;
    this.commitSelection();
  }

  private isUp(data: string, allowVimKeys = true): boolean {
    return (
      getKeybindings().matches(data, "tui.select.up") || (allowVimKeys && matchesKey(data, "k"))
    );
  }

  private isDown(data: string, allowVimKeys = true): boolean {
    return (
      getKeybindings().matches(data, "tui.select.down") || (allowVimKeys && matchesKey(data, "j"))
    );
  }

  private isConfirm(data: string): boolean {
    return getKeybindings().matches(data, "tui.select.confirm") || matchesKey(data, "return");
  }

  private isCancel(data: string): boolean {
    return getKeybindings().matches(data, "tui.select.cancel") || matchesKey(data, "escape");
  }

  private moveSelection(next: PermissionChoice): void {
    if (this.selected === next) return;

    this.selected = next;
    if (this.drafts[next]) {
      this.editing = true;
      this.cursor = this.drafts[next].length;
    } else {
      this.editing = false;
      this.cursor = 0;
    }
  }

  private commitSelection(): void {
    const note = this.currentDraft.trim();

    if (this.selected === "yes") {
      this.done(note ? { kind: "allow", note } : { kind: "allow" });
      return;
    }

    this.done(note ? { kind: "reject", abort: false, note } : { kind: "reject", abort: true });
  }

  private handleDraftInput(data: string): void {
    if (matchesKey(data, "left")) {
      if (this.cursor > 0) {
        this.cursor -= getPreviousGraphemeLength(this.currentDraft, this.cursor);
      }
      return;
    }

    if (matchesKey(data, "right")) {
      if (this.cursor < this.currentDraft.length) {
        this.cursor += getNextGraphemeLength(this.currentDraft, this.cursor);
      }
      return;
    }

    if (matchesKey(data, "home") || getKeybindings().matches(data, "tui.editor.cursorLineStart")) {
      this.cursor = 0;
      return;
    }

    if (matchesKey(data, "end") || getKeybindings().matches(data, "tui.editor.cursorLineEnd")) {
      this.cursor = this.currentDraft.length;
      return;
    }

    if (this.deleteBackward(data)) return;
    if (this.deleteForward(data)) return;

    const text = sanitizeDraftInput(data);
    if (!text || hasControlCharacters(text)) return;

    this.currentDraft =
      this.currentDraft.slice(0, this.cursor) + text + this.currentDraft.slice(this.cursor);
    this.cursor += text.length;
  }

  private deleteBackward(data: string): boolean {
    if (
      !getKeybindings().matches(data, "tui.editor.deleteCharBackward") &&
      !matchesKey(data, "backspace")
    ) {
      return false;
    }

    if (this.cursor > 0) {
      const len = getPreviousGraphemeLength(this.currentDraft, this.cursor);
      this.currentDraft =
        this.currentDraft.slice(0, this.cursor - len) + this.currentDraft.slice(this.cursor);
      this.cursor -= len;
    }
    return true;
  }

  private deleteForward(data: string): boolean {
    if (
      !getKeybindings().matches(data, "tui.editor.deleteCharForward") &&
      !matchesKey(data, "delete")
    ) {
      return false;
    }

    if (this.cursor < this.currentDraft.length) {
      const len = getNextGraphemeLength(this.currentDraft, this.cursor);
      this.currentDraft =
        this.currentDraft.slice(0, this.cursor) + this.currentDraft.slice(this.cursor + len);
    }
    return true;
  }

  private renderOptions(width: number): string[] {
    return CHOICES.flatMap((choice, index) => this.renderOption(choice, index + 1, width));
  }

  private renderOption(choice: PermissionChoice, number: number, width: number): string[] {
    const isSelected = this.selected === choice;
    const isEditing = isSelected && this.editing;
    const label =
      choice === "yes" ? this.requestPrompt.approveLabel : this.requestPrompt.rejectLabel;
    const draft = this.drafts[choice];
    const prefix = `${isSelected ? "→" : " "} ${number}. ${label}`;
    const styledPrefix = isSelected ? this.theme.fg("accent", prefix) : prefix;

    if (!isEditing) {
      if (!draft) return [styledPrefix];
      const suffix = this.theme.fg(isSelected ? "accent" : "muted", ", and...");
      return [styledPrefix + suffix];
    }

    return this.renderEditingOption(prefix, draft, width);
  }

  private renderEditingOption(prefix: string, draft: string, width: number): string[] {
    const rawDisplay = draft.length > 0 && this.cursor < draft.length ? draft : `${draft} `;
    const firstPrefix = `${prefix}, and `;
    const prefixWidth = visibleWidth(firstPrefix);
    const wrapped = wrapDraftText(rawDisplay, width - prefixWidth);

    return wrapped.map((line, lineIndex) => {
      const rowPrefix = lineIndex === 0 ? firstPrefix : " ".repeat(prefixWidth);
      const lineStart = line.startIndex;
      const lineEnd = line.startIndex + line.text.length;
      const hasCursor = this.cursor >= lineStart && this.cursor < lineEnd;

      if (!hasCursor) {
        return this.theme.fg("accent", rowPrefix + line.text);
      }

      const cursorLength = getNextGraphemeLength(rawDisplay, this.cursor);
      const localIndex = this.cursor - lineStart;
      const before = line.text.slice(0, localIndex);
      const cursorText = line.text.slice(localIndex, localIndex + cursorLength) || " ";
      const after = line.text.slice(localIndex + cursorLength);

      return (
        this.theme.fg("accent", rowPrefix + before) +
        (this.focused ? CURSOR_MARKER : "") +
        this.theme.inverse(cursorText) +
        this.theme.fg("accent", after)
      );
    });
  }

  private renderLegend(): string {
    return [
      hint(this.theme, "↑↓", "select"),
      hint(this.theme, "enter", "confirm"),
      hint(this.theme, "tab", "add note"),
      hint(this.theme, "shift+tab", "close"),
      hint(this.theme, "esc", "abort"),
    ].join("  ");
  }
}

export async function showPermissionGate(
  ctx: ExtensionContext,
  name: string,
  message: string,
  prompt: Required<Pick<PermissionRequestPrompt, "approveLabel" | "rejectLabel">>,
): Promise<PermissionGateResult> {
  return ctx.ui.custom<PermissionGateResult>(
    (_tui, theme, _keybindings, done) =>
      new PermissionPromptOverlay(theme, name, message, prompt, done),
  );
}

function hasControlCharacters(text: string): boolean {
  return [...text].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });
}
