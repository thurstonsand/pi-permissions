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
  type TuiMouseEvent,
  type TuiMouseEventResult,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { PermissionRequestLabels } from "../api.js";
import type { PermissionHighlight } from "../highlight.js";
import { formatHighlightedDetail } from "../presentation.js";
import { DraftInput, sanitizeDraftInput } from "./draft-input.js";
import { openExternalEditor } from "./external-editor.js";
import {
  type LegendHit,
  type LegendItem,
  type LegendLine,
  layoutLegend,
  legendHitAt,
} from "./legend.js";

export type PermissionGateResult =
  | { kind: "allow"; forSession?: true; note?: string }
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
// Content starts past the frame's left border and its one space of padding.
const CONTENT_X = 2;
const NUMBER_KEYS: readonly KeyId[] = ["1", "2", "3"];

function padRight(content: string, width: number): string {
  return content + " ".repeat(Math.max(0, width - visibleWidth(content)));
}

function stripCursorHighlight(line: string): string {
  // Drop the editor's inverse-video cursor (ESC[7m … ESC[0m), keeping the
  // character it sat on. The editor emits no other reverse-video runs.
  return line.replaceAll("\x1b[7m", "").replaceAll("\x1b[0m", "");
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
  private bodyScroll = 0;
  private bodyPageSize = 0;
  private bodyMaxScroll = 0;
  // Single-slot stash for the ctrl+r original/edits toggle. Non-null means the
  // buffer currently shows the pristine original and holds the approver's edits
  // in reserve; null means the buffer holds the live draft.
  private stashedEdits: string | null = null;
  // Rebuilt on every render: component row -> what is drawn on it. render()
  // runs before any pointer event can land, so it is the cheapest honest hit
  // map for a component that paints itself as flat lines. Each field's label
  // row counts as part of the field, so clicking a label focuses it without
  // disturbing the cursor.
  private readonly optionRows = new Map<
    number,
    { choice: PermissionChoice; offset: number; width: number }
  >();
  private editRows:
    | { commandStart: number; commandEnd: number; noteStart: number; noteEnd: number }
    | undefined;
  private notePrefixWidth = 0;
  private bodyWidth = 0;
  private readonly legendRows = new Map<number, LegendHit[]>();
  // The option a press landed on. Selecting a choice re-renders the detail box
  // at a different height, and pi retargets the release with the origin it
  // captured at press, so the click arrives holding a row number that now
  // points somewhere else. The gesture has to carry its own identity.
  private pressedChoice: PermissionChoice | undefined;
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

    // Reachable only past the edit-mode dispatch above, which is what confines
    // don't-ask-again to select mode — with or without a note open.
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
    if (event.button !== "left" && event.type !== "wheel") return undefined;

    // Assigned on every press, so a gesture abandoned by dragging away cannot
    // leak its choice into some later click.
    if (event.type === "press") {
      this.pressedChoice = this.mode === "select" ? this.pressableOptionAt(event) : undefined;
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
    const legend = this.clickLegend(event);
    if (legend) return legend;
    if (this.mode === "edit") return this.handleEditModeMouse(event);

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

  private clickLegend(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click") return undefined;
    const hits = this.legendRows.get(event.y);
    if (!hits) return undefined;

    const hit = legendHitAt(hits, event.x - CONTENT_X);
    if (!hit) return undefined;

    hit.run();
    return { handled: true };
  }

  // Both fields answer to clicks alone, the way pi's own Editor does, so a drag
  // across them still selects text for the clipboard.
  private handleEditModeMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const rows = this.editRows;
    if (!rows || event.type !== "click") return undefined;

    if (event.y >= rows.commandStart && event.y < rows.commandEnd) {
      this.focusEditField("command");
      if (event.y === rows.commandStart) return { handled: true, focus: true };
      return (
        this.editSession?.editor.handleMouse({
          ...event,
          x: event.x - CONTENT_X,
          y: event.y - rows.commandStart - 1,
          width: this.bodyWidth,
          height: rows.commandEnd - rows.commandStart - 1,
        }) ?? { handled: true, focus: true }
      );
    }

    if (event.y >= rows.noteStart && event.y < rows.noteEnd) {
      this.focusEditField("note");
      if (event.y > rows.noteStart) {
        this.drafts.edit.placeCursor(
          this.bodyWidth,
          event.y - rows.noteStart - 1,
          event.x - CONTENT_X,
        );
      }
      return { handled: true, focus: true };
    }

    return undefined;
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 2);
    const bodyWidth = Math.max(1, innerWidth - 1);
    const border = (text: string) => this.theme.fg("border", text);
    const row = (content = "") => `${border("│")} ${padRight(content, bodyWidth)}${border("│")}`;

    this.optionRows.clear();
    this.editRows = undefined;
    this.legendRows.clear();
    this.bodyWidth = bodyWidth;
    const content =
      this.mode === "edit" ? this.renderEditMode(bodyWidth) : this.renderSelectMode(bodyWidth);

    return [
      border(`╭${"─".repeat(innerWidth)}╮`),
      ...content.map((line) => row(line)),
      border(`╰${"─".repeat(innerWidth)}╯`),
    ];
  }

  private renderSelectMode(bodyWidth: number): string[] {
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

    const legend = this.renderSelectLegend();
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

  // The detail box shows what the highlighted choice will run: the approver's
  // live buffer under Edit, the agent's original otherwise. Highlights are
  // decision-scoped evidence about the original, so they are drawn only on it
  // and never projected onto the edit.
  private detailText(): string {
    if (this.selected === "edit" && this.editSession) {
      return this.editSession.editor.getExpandedText().trim();
    }
    const emphasize = (fragment: string) => this.theme.fg("warning", this.theme.bold(fragment));
    return formatHighlightedDetail(this.view.detail, this.view.highlight, emphasize);
  }

  private renderEditMode(bodyWidth: number): string[] {
    if (!this.editSession) return [];

    // The pi Editor always paints its inverse-video cursor regardless of its
    // focused flag, so strip it while the note field holds focus — otherwise
    // both fields show a cursor at once.
    const commandLines = this.editSession.editor.render(bodyWidth);
    const command =
      this.editField === "command" ? commandLines : commandLines.map(stripCursorHighlight);
    const note = this.drafts.edit.renderLines(bodyWidth, {
      color: "dim",
      showCursor: this.editField === "note",
      focused: this.focused,
    });

    const head = [this.theme.fg("accent", this.theme.bold(this.view.name)), "", "Command"];
    const between = [
      this.warning ? this.theme.fg("error", this.warning) : "",
      this.theme.fg("dim", "Note to agent"),
    ];

    // render() frames this content in a border, so content line i lands on row
    // i + 1. Each field starts at its label and ends past its last drawn line.
    const commandStart = head.length;
    const commandEnd = commandStart + 1 + command.length;
    const noteStart = commandEnd + between.length - 1;
    const noteEnd = noteStart + 1 + note.length;
    this.editRows = { commandStart, commandEnd, noteStart, noteEnd };

    const legend = this.renderEditLegend();
    this.registerLegend(noteEnd + 1, legend);

    return [...head, ...command, ...between, ...note, "", ...legend.map((line) => line.text)];
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
  // highlighted or being annotated: it is an approval, and notes drafted on Edit
  // or Abort belong to outcomes the approver is walking away from.
  private commitDontAskAgain(): void {
    const note = this.drafts.yes.trimmed;
    this.done(
      note ? { kind: "allow", forSession: true, note } : { kind: "allow", forSession: true },
    );
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
    if (this.editField === "command") {
      this.focusEditField("note");
      this.drafts.edit.toEnd();
    } else {
      this.focusEditField("command");
    }
  }

  // The embedded Editor paints the cursor pi positions the hardware cursor and
  // IME window from, and it only paints it while focused. Every path that moves
  // between the fields goes through here, or keyboard and mouse navigation end
  // up disagreeing about which field is live.
  private focusEditField(field: EditField): void {
    if (!this.editSession) return;
    this.editField = field;
    this.editSession.editor.focused = field === "command";
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

  private renderSelectLegend(): LegendLine[] {
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

    return [layoutLegend(this.theme, first), layoutLegend(this.theme, second)];
  }

  private renderEditLegend(): LegendLine[] {
    const first: LegendItem[] = [
      { key: "enter", description: "run", run: () => this.submitEdit() },
    ];
    // shift+enter inserts a newline only in the multi-line command editor; the
    // note field is single-line and ignores it.
    if (this.editField === "command") {
      first.push({ key: "shift+enter", description: "newline" });
    }
    first.push({
      key: "tab",
      description: `switch to ${this.editField === "command" ? "note" : "command"}`,
      run: () => this.toggleEditField(),
    });

    const second: LegendItem[] = [
      {
        key: "ctrl+g",
        description: "external editor",
        run: () => void this.openExternalForFocusedField(),
      },
      {
        // Swap target doubles as the state indicator: "original" when the buffer
        // holds edits, "your edits" when it holds the stashed-away original.
        key: "ctrl+r",
        description: this.stashedEdits === null ? "original" : "your edits",
        run: () => this.toggleOriginalStash(),
      },
      {
        key: "esc",
        description: "back",
        run: () => {
          this.warning = null;
          this.mode = "select";
        },
      },
    ];

    return [layoutLegend(this.theme, first), layoutLegend(this.theme, second)];
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
