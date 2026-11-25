import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Focusable,
  getKeybindings,
  type KeyId,
  matchesKey,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { PermissionRequestLabels } from "../api.js";
import type { PermissionHighlight } from "../highlight.js";
import { formatHighlightedDetail } from "../presentation.js";
import { DraftInput } from "./draft-input.js";
import {
  type LegendHit,
  type LegendItem,
  type LegendLine,
  LegendPointer,
  layoutLegend,
  legendHitAt,
} from "./legend.js";

export type PermissionGateResult =
  | { kind: "allow"; forSession?: true; note?: string }
  | { kind: "reject"; abort: boolean; note?: string };

type PermissionChoice = "yes" | "no";

type ResolvedLabels = Required<PermissionRequestLabels>;

export interface PermissionPromptView {
  name: string;
  header: string;
  toolName: string;
  detail: string;
  highlight?: PermissionHighlight;
  labels: ResolvedLabels;
}

// Content starts past the frame's left border and its one space of padding.
const CONTENT_X = 2;
const NUMBER_KEYS: readonly KeyId[] = ["1", "2"];

function padRight(content: string, width: number): string {
  return content + " ".repeat(Math.max(0, width - visibleWidth(content)));
}

function wrapParagraphs(text: string, width: number): string[] {
  return text
    .split("\n")
    .flatMap((line) => (line ? wrapTextWithAnsi(line, Math.max(1, width)) : [""]));
}

class PermissionPromptOverlay implements Focusable {
  focused = false;

  private selected: PermissionChoice = "yes";
  private editing = false;
  private tabUsed = false;
  private bodyScroll = 0;
  private bodyPageSize = 0;
  private bodyMaxScroll = 0;
  // Rebuilt on every render: component row -> what is drawn on it. render()
  // runs before any pointer event can land, so it is the cheapest honest hit
  // map for a component that paints itself as flat lines. Each field's label
  // row counts as part of the field, so clicking a label focuses it without
  // disturbing the cursor.
  private readonly optionRows = new Map<
    number,
    { choice: PermissionChoice; offset: number; width: number }
  >();
  private notePrefixWidth = 0;
  private bodyWidth = 0;
  private readonly legendRows = new Map<number, LegendHit[]>();
  private readonly legendPointer = new LegendPointer(() => this.tui.requestRender());
  // The option a press landed on. Selecting a choice closes an open note, which
  // can re-render the options at a different height, and pi retargets the release with the origin it
  // captured at press, so the click arrives holding a row number that now
  // points somewhere else. The gesture has to carry its own identity.
  private pressedChoice: PermissionChoice | undefined;
  private readonly drafts: Record<PermissionChoice, DraftInput>;
  private readonly choices: PermissionChoice[] = ["yes", "no"];

  constructor(
    private tui: TUI,
    private theme: Theme,
    private view: PermissionPromptView,
    private done: (result: PermissionGateResult) => void,
  ) {
    this.drafts = { yes: new DraftInput(theme), no: new DraftInput(theme) };
  }

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

    if (this.isDontAskAgain(data)) {
      this.commitDontAskAgain();
      return;
    }

    if (this.editing) {
      this.handleEditingInput(data);
      return;
    }

    this.handleSelectionInput(data);
  }

  // Pi only routes pointer input in fullscreen mode; elsewhere this never runs.
  // Hover deliberately does not move the highlight the way pi's own SelectList
  // does: this prompt authorizes commands, and a selection that follows the
  // pointer would put whatever the mouse last grazed under the enter key.
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "press") this.pressedChoice = undefined;
    if (!this.pressedChoice) {
      const hits = this.legendRows.get(event.y);
      const hit = hits ? legendHitAt(hits, event.x - CONTENT_X) : undefined;
      const legend = this.legendPointer.handleMouse(event, hit);
      if (legend) return legend;
    }
    if (event.button !== "left" && event.type !== "wheel") return undefined;

    // Assigned on every press, so a gesture abandoned by dragging away cannot
    // leak its choice into some later click.
    if (event.type === "press") {
      this.pressedChoice = this.pressableOptionAt(event);
      if (!this.pressedChoice) return undefined;

      const changed = this.selected !== this.pressedChoice;
      this.moveSelection(this.pressedChoice);
      return { handled: true, focus: true, render: changed };
    }

    if (event.type === "click" && this.pressedChoice) {
      const choice = this.pressedChoice;
      this.pressedChoice = undefined;
      this.moveSelection(choice);
      this.commitSelection();
      return { handled: true };
    }

    // Everything below reaches a click that no press of ours claimed, which pi
    // delivers with a freshly resolved row. Nothing has reflowed under it.
    if (event.type === "wheel") {
      if (this.bodyPageSize === 0) return undefined;
      return { handled: true, render: this.scrollBodyLines(event.wheelDelta ?? 0) };
    }

    return this.clickOpenNote(event);
  }

  /** The option a press can act on: not an open note, and within the option's own text. */
  private pressableOptionAt(event: TuiMouseEvent): PermissionChoice | undefined {
    const target = this.optionRows.get(event.y);
    if (!target) return undefined;
    // An open note is a text field, not a button. Committing on a click there
    // would authorize the command out from under someone reaching for a typo,
    // so the note is left to the click path below.
    if (this.editing && target.choice === this.selected) return undefined;
    // Only the option's own text is the control. The rest of the row is frame
    // padding, and nothing that looks inert should decide anything.
    if (event.x < CONTENT_X || event.x >= CONTENT_X + target.width) return undefined;
    return target.choice;
  }

  private clickOpenNote(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || !this.editing) return undefined;
    const target = this.optionRows.get(event.y);
    if (target?.choice !== this.selected) return undefined;

    this.drafts[this.selected].placeCursor(
      this.bodyWidth,
      target.offset,
      event.x - CONTENT_X,
      this.notePrefixWidth,
    );
    return { handled: true, focus: true };
  }

  private registerLegend(firstRow: number, legend: LegendLine[]): void {
    legend.forEach((line, index) => {
      if (line.hits.length > 0) this.legendRows.set(firstRow + index, line.hits);
    });
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 2);
    const bodyWidth = Math.max(1, innerWidth - 1);
    const border = (text: string) => this.theme.fg("border", text);
    const row = (content = "") => `${border("│")} ${padRight(content, bodyWidth)}${border("│")}`;

    this.optionRows.clear();
    this.legendRows.clear();
    this.bodyWidth = bodyWidth;
    const content = this.renderContent(bodyWidth);

    return [
      border(`╭${"─".repeat(innerWidth)}╮`),
      ...content.map((line) => row(line)),
      border(`╰${"─".repeat(innerWidth)}╯`),
    ];
  }

  private renderContent(bodyWidth: number): string[] {
    const top = [this.theme.fg("accent", this.theme.bold(this.view.name)), ""];
    const header = this.view.header ? [...wrapParagraphs(this.view.header, bodyWidth), ""] : [];
    const options = this.renderOptions(bodyWidth);
    const optionLines = options.flatMap(({ lines }) => lines);
    // The legend advertises f/b only when the detail overflows, so it is
    // rendered after the detail box settles the scroll state. Its line count is
    // constant either way, so the height budget below stays honest.
    const bottomLineCount = 1 + optionLines.length + 1 + 2;
    const detail = this.renderDetailBox(bodyWidth, top.length + header.length + bottomLineCount);

    // render() frames this content in a border, so content line i lands on row
    // i + 1. The blank separator before the options costs one more.
    let row = top.length + header.length + detail.length + 2;
    for (const { choice, lines } of options) {
      for (let offset = 0; offset < lines.length; offset++) {
        this.optionRows.set(row++, {
          choice,
          offset,
          width: visibleWidth(lines[offset] ?? ""),
        });
      }
    }

    const legend = this.renderLegend();
    this.registerLegend(row + 1, legend);

    return [
      ...top,
      ...header,
      ...detail,
      "",
      ...optionLines,
      "",
      ...legend.map((line) => line.text),
    ];
  }

  // The detail is the one agent-authored, unbounded element of the prompt, so
  // it gets its own frame: an inner box labeled with the tool name, windowed to
  // the terminal when the content is taller than the screen.
  private renderDetailBox(bodyWidth: number, pinnedLines: number): string[] {
    const boxWidth = Math.max(10, bodyWidth - 1);
    const contentWidth = boxWidth - 4;
    const { lines, above, below } = this.windowBody(
      wrapParagraphs(this.detailText(), contentWidth),
      pinnedLines + 2,
    );

    const border = (text: string) => this.theme.fg("borderMuted", text);
    const edge = (lead: string, left: string, right: string) => {
      const fill = "─".repeat(Math.max(0, boxWidth - 2 - visibleWidth(lead)));
      return border(`${left}${lead}${fill}${right}`);
    };
    const row = (line: string) => `${border("│")} ${padRight(line, contentWidth)} ${border("│")}`;

    // The off-screen tag pins to the bottom-left so it never jumps around;
    // only the arrows change with scroll position.
    const offscreen = [above > 0 ? `↑ ${above}` : "", below > 0 ? `↓ ${below}` : ""]
      .filter(Boolean)
      .join(" ");

    return [
      edge(`─ ${this.view.toolName} `, "╭", "╮"),
      ...lines.map(row),
      edge(offscreen ? `─ ${offscreen} more ` : "", "╰", "╯"),
    ];
  }

  // The prompt replaces pi's editor at the bottom of the screen, so a body
  // taller than the terminal pushes the options and legend out of the viewport.
  // Window the body to what fits — everything around it stays pinned — and let
  // f/b page through the rest.
  // TODO: pi 0.84.0's fullscreen TUI mode routes mouse-wheel events to
  // ScrollView components under the pointer. Once on ≥0.84.0, consider
  // rebuilding the detail window as a ScrollView (overscroll "contain") so the
  // wheel works there; f/b must remain for regular mode.
  private windowBody(
    body: string[],
    pinnedLines: number,
  ): { lines: string[]; above: number; below: number } {
    const borderAndMargin = 4;
    const available = Math.max(3, this.tui.terminal.rows - pinnedLines - borderAndMargin);

    if (body.length <= available) {
      this.bodyScroll = 0;
      this.bodyPageSize = 0;
      this.bodyMaxScroll = 0;
      return { lines: body, above: 0, below: 0 };
    }

    this.bodyPageSize = available;
    this.bodyMaxScroll = body.length - available;
    this.bodyScroll = Math.min(this.bodyScroll, this.bodyMaxScroll);

    const end = this.bodyScroll + available;
    return {
      lines: body.slice(this.bodyScroll, end),
      above: this.bodyScroll,
      below: body.length - end,
    };
  }

  private detailText(): string {
    const emphasize = (fragment: string) => this.theme.fg("warning", this.theme.bold(fragment));
    return formatHighlightedDetail(this.view.detail, this.view.highlight, emphasize);
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
    if (this.bodyPageSize > 0 && matchesKey(data, "f")) {
      this.scrollBodyBy(1);
      return;
    }

    if (this.bodyPageSize > 0 && matchesKey(data, "b")) {
      this.scrollBodyBy(-1);
      return;
    }

    if (matchesKey(data, "tab")) {
      this.openNote();
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

  private scrollBodyBy(direction: 1 | -1): void {
    this.scrollBodyLines(direction * this.bodyPageSize);
    this.tui.requestRender();
  }

  private scrollBodyLines(lines: number): boolean {
    const next = Math.min(this.bodyMaxScroll, Math.max(0, this.bodyScroll + lines));
    if (next === this.bodyScroll) return false;
    this.bodyScroll = next;
    return true;
  }

  private openNote(): void {
    this.tabUsed = true;
    this.editing = true;
    this.drafts[this.selected].toEnd();
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

  private isDontAskAgain(data: string): boolean {
    return matchesKey(data, "ctrl+s");
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

  // Don't ask again always speaks with the Authorize note, whatever choice is
  // highlighted or being annotated: it is an approval, and a note drafted on
  // Abort belongs to an outcome the approver is walking away from.
  private commitDontAskAgain(): void {
    const note = this.drafts.yes.trimmed;
    this.done(
      note ? { kind: "allow", forSession: true, note } : { kind: "allow", forSession: true },
    );
  }

  private commitSelection(): void {
    const note = this.drafts[this.selected].trimmed;

    if (this.selected === "yes") {
      this.done(note ? { kind: "allow", note } : { kind: "allow" });
      return;
    }

    this.done(note ? { kind: "reject", abort: false, note } : { kind: "reject", abort: true });
  }

  private labelFor(choice: PermissionChoice): string {
    return choice === "yes" ? this.view.labels.approveLabel : this.view.labels.rejectLabel;
  }

  private renderOptions(width: number): { choice: PermissionChoice; lines: string[] }[] {
    return this.choices.map((choice, index) => ({
      choice,
      lines: this.renderOption(choice, index + 1, width),
    }));
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

    const firstPrefix = `${prefix}, and `;
    this.notePrefixWidth = visibleWidth(firstPrefix);
    return draft.renderLines(width, {
      color: "accent",
      showCursor: true,
      focused: this.focused,
      firstPrefix,
    });
  }

  private renderLegend(): LegendLine[] {
    const first: LegendItem[] = [{ key: "↑↓", description: "select" }];
    if (this.bodyPageSize > 0) first.push({ key: "f/b", description: "scroll" });
    first.push(
      { key: "enter", description: "confirm", run: () => this.commitSelection() },
      { key: "ctrl+s", description: "don't ask again", run: () => this.commitDontAskAgain() },
    );

    const second: LegendItem[] = [
      { key: "tab", description: "add note", run: () => this.openNote() },
      {
        key: "shift+tab",
        description: "close",
        run: () => {
          this.editing = false;
        },
      },
      { key: "esc", description: "abort", run: () => this.done({ kind: "reject", abort: true }) },
    ];

    const options = { pressedKey: this.legendPointer.pressedKey };
    return [layoutLegend(this.theme, first, options), layoutLegend(this.theme, second, options)];
  }
}

// Resolves undefined, without an answer, once retract aborts.
export async function showPermissionGate(
  ctx: ExtensionContext,
  view: PermissionPromptView,
  retract: AbortSignal,
): Promise<PermissionGateResult | undefined> {
  return ctx.ui.custom<PermissionGateResult | undefined>(
    (tui, theme, _keybindings, done) => {
      retract.addEventListener("abort", () => done(undefined), { once: true });
      return new PermissionPromptOverlay(tui, theme, view, done);
    },
    { blocked: { kind: "permission", message: view.name } },
  );
}
