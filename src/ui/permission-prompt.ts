import {
  type ExtensionContext,
  getAgentDir,
  type KeybindingsManager,
  SettingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  type Focusable,
  getKeybindings,
  type KeyId,
  matchesKey,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { PermissionRequestLabels } from "../api.js";
import type { PermissionHighlight } from "../highlight.js";
import { formatToolDetailLine } from "../presentation.js";
import { DraftInput, sanitizeDraftInput } from "./draft-input.js";
import { openExternalEditor } from "./external-editor.js";

export type PermissionGateResult =
  | { kind: "allow"; note?: string }
  | { kind: "reject"; abort: boolean; note?: string }
  | { kind: "edit"; command: string; note?: string };

type PermissionChoice = "yes" | "edit" | "no";
type PromptMode = "select" | "edit";
type EditField = "command" | "note";

type ResolvedLabels = Required<PermissionRequestLabels>;

export interface PermissionPromptView {
  name: string;
  header: string;
  toolName: string;
  detail: string;
  highlight?: PermissionHighlight;
  labels: ResolvedLabels;
  editable?: { command: string };
}

type EditSession = { original: string; editor: Editor };

const EMPTY_COMMAND_WARNING = "An empty command achieves nothing";
const NUMBER_KEYS: readonly KeyId[] = ["1", "2", "3"];

function padRight(content: string, width: number): string {
  return content + " ".repeat(Math.max(0, width - visibleWidth(content)));
}

function stripCursorHighlight(line: string): string {
  // Drop the editor's inverse-video cursor (ESC[7m … ESC[0m), keeping the
  // character it sat on. The editor emits no other reverse-video runs.
  return line.replaceAll("\x1b[7m", "").replaceAll("\x1b[0m", "");
}

function hint(theme: Theme, key: string, description: string): string {
  return theme.fg("dim", key) + theme.fg("muted", ` ${description}`);
}

function wrapParagraphs(text: string, width: number): string[] {
  return text
    .split("\n")
    .flatMap((line) => (line ? wrapTextWithAnsi(line, Math.max(1, width)) : [""]));
}

function buildEditorTheme(theme: Theme): EditorTheme {
  const dim = (text: string) => theme.fg("dim", text);
  return {
    borderColor: (text: string) => theme.fg("borderMuted", text),
    selectList: {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: dim,
      scrollInfo: dim,
      noMatch: dim,
    },
  };
}

class PermissionPromptOverlay implements Focusable {
  focused = false;

  private mode: PromptMode = "select";
  private selected: PermissionChoice = "yes";
  private editing = false;
  private tabUsed = false;
  private editField: EditField = "command";
  private warning: string | null = null;
  // Single-slot stash for the ctrl+r original/edits toggle. Non-null means the
  // buffer currently shows the pristine original and holds the approver's edits
  // in reserve; null means the buffer holds the live draft.
  private stashedEdits: string | null = null;
  private readonly drafts: Record<PermissionChoice, DraftInput>;
  private readonly choices: PermissionChoice[];
  private readonly editSession?: EditSession;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private keybindings: KeybindingsManager,
    private view: PermissionPromptView,
    private externalEditorCommand: string,
    private done: (result: PermissionGateResult) => void,
  ) {
    this.drafts = {
      yes: new DraftInput(theme),
      edit: new DraftInput(theme),
      no: new DraftInput(theme),
    };
    this.choices = view.editable ? ["yes", "edit", "no"] : ["yes", "no"];

    if (view.editable) {
      const editor = new Editor(tui, buildEditorTheme(theme));
      editor.setText(view.editable.command);
      this.editSession = { original: view.editable.command, editor };
    }
  }

  invalidate(): void {}
  dispose(): void {}

  handleInput(data: string): void {
    if (this.mode === "edit") {
      this.handleEditModeInput(data);
      return;
    }

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

    const content =
      this.mode === "edit" ? this.renderEditMode(bodyWidth) : this.renderSelectMode(bodyWidth);

    return [
      border(`╭${"─".repeat(innerWidth)}╮`),
      ...content.map((line) => row(line)),
      border(`╰${"─".repeat(innerWidth)}╯`),
    ];
  }

  private renderSelectMode(bodyWidth: number): string[] {
    const header = this.view.header ? [...wrapParagraphs(this.view.header, bodyWidth), ""] : [];

    return [
      this.theme.fg("accent", this.theme.bold(this.view.name)),
      "",
      ...header,
      ...wrapParagraphs(this.renderDetail(), bodyWidth),
      "",
      ...this.renderOptions(bodyWidth),
      "",
      this.renderSelectLegend(),
    ];
  }

  // Highlights are evidence attached to the one-time verdict about the command
  // the agent proposed. They are computed once against that original command and
  // never recomputed against or projected into the approver's edit buffer, so
  // the select-mode detail line always shows the original.
  // The detail line shows what the highlighted choice will run: the approver's
  // live buffer under Edit, the agent's original otherwise. Highlights are
  // decision-scoped evidence about the original, so they are drawn only on it
  // and never projected onto the edit.
  private renderDetail(): string {
    const emphasize = (fragment: string) => this.theme.fg("warning", this.theme.bold(fragment));
    if (this.selected === "edit" && this.editSession) {
      const edited = this.editSession.editor.getExpandedText().trim();
      return formatToolDetailLine(this.view.toolName, edited, undefined, emphasize);
    }
    return formatToolDetailLine(
      this.view.toolName,
      this.view.detail,
      this.view.highlight,
      emphasize,
    );
  }

  private renderEditMode(bodyWidth: number): string[] {
    if (!this.editSession) return [];

    // The pi Editor always paints its inverse-video cursor regardless of its
    // focused flag, so strip it while the note field holds focus — otherwise
    // both fields show a cursor at once.
    const commandLines = this.editSession.editor.render(bodyWidth);
    const command =
      this.editField === "command" ? commandLines : commandLines.map(stripCursorHighlight);

    return [
      this.theme.fg("accent", this.theme.bold(this.view.name)),
      "",
      "Command",
      ...command,
      this.warning ? this.theme.fg("error", this.warning) : "",
      this.theme.fg("dim", "Note to agent"),
      ...this.drafts.edit.renderLines(bodyWidth, {
        color: "dim",
        showCursor: this.editField === "note",
        focused: this.focused,
      }),
      "",
      ...this.renderEditLegend(),
    ];
  }

  private handleEditModeInput(data: string): void {
    if (!this.editSession) return;
    this.warning = null;

    if (this.isCancel(data)) {
      this.mode = "select";
      return;
    }

    if (this.keybindings.matches(data, "app.editor.external")) {
      void this.openExternalForFocusedField();
      return;
    }

    if (matchesKey(data, "ctrl+r")) {
      this.toggleOriginalStash();
      return;
    }

    // Only tab is advertised in the legend, but shift+tab toggles too: with two
    // fields either direction flips focus, and honoring both matches muscle
    // memory.
    if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
      this.toggleEditField();
      return;
    }

    // Enter submits from either field. Intercepting it here keeps a single
    // submit path through submitEdit; the Editor's own submit (which trims and
    // wipes its buffer) is never reached. Shift+enter still falls through for
    // newlines.
    if (this.isConfirm(data)) {
      this.submitEdit();
      return;
    }

    if (this.editField === "command") {
      this.editSession.editor.handleInput(data);
      this.reconcileStash();
      return;
    }

    this.drafts.edit.handleInput(data);
  }

  // ctrl+r swaps which lineage occupies the buffer rather than destroying edits:
  // showing edits -> stash them and load the original; showing the original ->
  // restore the stashed edits. A no-op when the buffer already equals the
  // original with nothing stashed.
  private toggleOriginalStash(): void {
    if (!this.editSession) return;
    const { editor, original } = this.editSession;

    if (this.stashedEdits === null) {
      if (this.bufferMatchesOriginal()) return;
      this.stashedEdits = editor.getExpandedText();
      editor.setText(original);
    } else {
      editor.setText(this.stashedEdits);
      this.stashedEdits = null;
    }
  }

  // Modifying the buffer while it shows the original discards the stash: the
  // approver has chosen to start over from the original, so the old edits are
  // not resurrectable.
  private reconcileStash(): void {
    if (this.stashedEdits !== null && !this.bufferMatchesOriginal()) {
      this.stashedEdits = null;
    }
  }

  private bufferMatchesOriginal(): boolean {
    if (!this.editSession) return true;
    return this.editSession.editor.getExpandedText().trim() === this.editSession.original.trim();
  }

  private handleEditingInput(data: string): void {
    if (this.isUp(data, false)) {
      this.moveSelectionBy(-1);
      return;
    }
    if (this.isDown(data, false)) {
      this.moveSelectionBy(1);
      return;
    }
    if (this.isConfirm(data)) {
      this.commitSelection();
      return;
    }
    if (matchesKey(data, "tab")) return;
    this.drafts[this.selected].handleInput(data);
  }

  private handleSelectionInput(data: string): void {
    if (matchesKey(data, "tab")) {
      this.tabUsed = true;
      this.editing = true;
      this.drafts[this.selected].toEnd();
      return;
    }

    if (this.isUp(data)) {
      this.moveSelectionBy(-1);
      return;
    }

    if (this.isDown(data)) {
      this.moveSelectionBy(1);
      return;
    }

    const numbered = this.choiceForNumberKey(data);
    if (numbered) {
      this.selectByNumber(numbered);
      return;
    }

    if (this.isConfirm(data)) {
      this.commitSelection();
    }
  }

  private choiceForNumberKey(data: string): PermissionChoice | undefined {
    return this.choices.find((_, index) => {
      const key = NUMBER_KEYS[index];
      return key !== undefined && matchesKey(data, key);
    });
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

  private moveSelectionBy(delta: number): void {
    const index = this.choices.indexOf(this.selected);
    const nextIndex = Math.min(this.choices.length - 1, Math.max(0, index + delta));
    const next = this.choices[nextIndex];
    if (next) this.moveSelection(next);
  }

  private moveSelection(next: PermissionChoice): void {
    if (this.selected === next) return;

    // Navigation never enters note editing — that requires an explicit tab — so
    // j/k and arrows keep moving between choices even when the target choice
    // already carries a draft note.
    this.selected = next;
    this.editing = false;
  }

  private commitSelection(): void {
    if (this.selected === "edit") {
      this.enterEditMode();
      return;
    }

    const note = this.drafts[this.selected].trimmed;

    if (this.selected === "yes") {
      this.done(note ? { kind: "allow", note } : { kind: "allow" });
      return;
    }

    this.done(note ? { kind: "reject", abort: false, note } : { kind: "reject", abort: true });
  }

  private enterEditMode(): void {
    if (!this.editSession) return;
    this.mode = "edit";
    this.editing = false;
    this.selected = "edit";
    this.editField = "command";
    this.warning = null;
    this.drafts.edit.toEnd();
    this.editSession.editor.focused = true;
  }

  private toggleEditField(): void {
    if (!this.editSession) return;
    if (this.editField === "command") {
      this.editField = "note";
      this.drafts.edit.toEnd();
      this.editSession.editor.focused = false;
    } else {
      this.editField = "command";
      this.editSession.editor.focused = true;
    }
  }

  private submitEdit(): void {
    if (!this.editSession) return;

    const command = this.editSession.editor.getExpandedText().trim();
    if (command.length === 0) {
      this.warning = EMPTY_COMMAND_WARNING;
      return;
    }

    const note = this.drafts.edit.trimmed;

    if (command === this.editSession.original.trim()) {
      this.done(note ? { kind: "allow", note } : { kind: "allow" });
      return;
    }

    this.done(note ? { kind: "edit", command, note } : { kind: "edit", command });
  }

  private async openExternalForFocusedField(): Promise<void> {
    if (!this.editSession) return;

    if (this.editField === "command") {
      const next = await openExternalEditor(
        this.tui,
        this.externalEditorCommand,
        this.editSession.editor.getExpandedText(),
      );
      if (next !== null) {
        this.editSession.editor.setText(next);
        this.reconcileStash();
      }
      return;
    }

    const next = await openExternalEditor(
      this.tui,
      this.externalEditorCommand,
      this.drafts.edit.text,
    );
    if (next !== null) this.drafts.edit.setText(sanitizeDraftInput(next));
  }

  private labelFor(choice: PermissionChoice): string {
    if (choice === "yes") return this.view.labels.approveLabel;
    if (choice === "no") return this.view.labels.rejectLabel;
    return this.view.labels.editLabel;
  }

  private renderOptions(width: number): string[] {
    return this.choices.flatMap((choice, index) => this.renderOption(choice, index + 1, width));
  }

  private renderOption(choice: PermissionChoice, number: number, width: number): string[] {
    const isSelected = this.selected === choice;
    const isEditing = isSelected && this.editing;
    const draft = this.drafts[choice];
    const prefix = `${isSelected ? "→" : " "} ${number}. ${this.labelFor(choice)}`;
    const styledPrefix = isSelected ? this.theme.fg("accent", prefix) : prefix;

    if (!isEditing) {
      if (!draft.text) return [styledPrefix];
      const suffix = this.theme.fg(isSelected ? "accent" : "muted", ", and...");
      return [styledPrefix + suffix];
    }

    return draft.renderLines(width, {
      color: "accent",
      showCursor: true,
      focused: this.focused,
      firstPrefix: `${prefix}, and `,
    });
  }

  private renderSelectLegend(): string {
    return [
      hint(this.theme, "↑↓", "select"),
      hint(this.theme, "enter", "confirm"),
      hint(this.theme, "tab", "add note"),
      hint(this.theme, "shift+tab", "close"),
      hint(this.theme, "esc", "abort"),
    ].join("  ");
  }

  private renderEditLegend(): string[] {
    const firstLine = [hint(this.theme, "enter", "run")];
    // shift+enter inserts a newline only in the multi-line command editor; the
    // note field is single-line and ignores it.
    if (this.editField === "command") {
      firstLine.push(hint(this.theme, "shift+enter", "newline"));
    }
    firstLine.push(
      hint(this.theme, "tab", `switch to ${this.editField === "command" ? "note" : "command"}`),
    );

    return [
      firstLine.join("  "),
      [
        hint(this.theme, "ctrl+g", "external editor"),
        // Swap target doubles as the state indicator: "original" when the buffer
        // holds edits, "your edits" when it holds the stashed-away original.
        hint(this.theme, "ctrl+r", this.stashedEdits === null ? "original" : "your edits"),
        hint(this.theme, "esc", "back"),
      ].join("  "),
    ];
  }
}

export async function showPermissionGate(
  ctx: ExtensionContext,
  view: PermissionPromptView,
): Promise<PermissionGateResult> {
  const externalEditorCommand = view.editable ? resolveExternalEditorCommand(ctx) : "";
  return ctx.ui.custom<PermissionGateResult>(
    (tui, theme, keybindings, done) =>
      new PermissionPromptOverlay(tui, theme, keybindings, view, externalEditorCommand, done),
  );
}

// Resolve the approver's external editor the same way pi does for its own
// input: the `externalEditor` setting, then $VISUAL/$EDITOR, then a platform
// default.
function resolveExternalEditorCommand(ctx: ExtensionContext): string {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });
  return settings.getExternalEditorCommand() ?? (process.platform === "win32" ? "notepad" : "nano");
}
