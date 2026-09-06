import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  matchesKey,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { PermissionSource } from "../api.js";
import {
  formatActiveCount,
  getPermissionEnablementStatus,
  isPermissionHookEnabled,
  type PermissionEnablement,
  type RuntimePermissionHook,
  setPermissionHookEnabled,
  toggleAllPermissionHooks,
} from "../enablement.js";
import {
  type LegendHit,
  type LegendItem,
  type LegendLine,
  LegendPointer,
  layoutLegend,
  legendHitAt,
} from "./legend.js";

const MAX_VISIBLE_LINES = 12;
const MAX_LIST_PANE_WIDTH = 30;
// Row content starts past the modal's left border and its one space of padding.
const CONTENT_X = 2;

type ListLine =
  | { kind: "hook"; hook: RuntimePermissionHook; index: number }
  | { kind: "label"; source: PermissionSource }
  | { kind: "blank" };

function formatSourceLabel(source: PermissionSource): string {
  return source.startsWith("package:") ? source.slice("package:".length) : source;
}

function formatPlainSummary(
  hooks: RuntimePermissionHook[],
  enablement: PermissionEnablement,
): string {
  const status = getPermissionEnablementStatus(hooks, enablement);
  const lines = [formatActiveCount(status), ""];

  for (const hook of hooks) {
    const enabled = isPermissionHookEnabled(enablement, hook);
    lines.push(`${enabled ? "[enabled]" : "[disabled]"} ${hook.name}`);
    lines.push(`  ${hook.description}`);
    lines.push(`  ${hook.modulePath}`);
  }

  lines.push("");
  lines.push("Usage: /permissions [enable|disable [permission name]]");
  return lines.join("\n");
}

function padRight(content: string, width: number): string {
  return content + " ".repeat(Math.max(0, width - visibleWidth(content)));
}

export class PermissionsSummaryOverlay {
  private selectedIndex = 0;
  private scrollOffset = 0;
  private draft: PermissionEnablement;
  // Overlay row -> the hook drawn on it, rebuilt every render. Only rows the
  // list actually occupies; a detail pane taller than the window leaves rows
  // below it that belong to no hook.
  private readonly hookRows = new Map<number, number>();
  private legendRow: { row: number; hits: LegendHit[] } | undefined;
  private readonly legendPointer = new LegendPointer(() => this.requestRender());
  // The hook a press landed on. Selecting one can scroll the list to reveal its
  // origin label, and pi retargets the release with the origin captured at
  // press, so the click's row number no longer means what it did.
  private pressedHook: number | undefined;
  // The list cell's columns. A hook row spans the full modal width, but the
  // half of it right of the divider belongs to the detail pane.
  private listCellEndX = 0;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private hooks: RuntimePermissionHook[],
    enablement: PermissionEnablement,
    private done: (enablement: PermissionEnablement | undefined) => void,
  ) {
    this.draft = { ...enablement };
  }

  handleInput(data: string): void {
    if (this.isCancel(data)) {
      this.done(undefined);
      return;
    }

    if (this.isConfirm(data)) {
      this.done(this.draft);
      return;
    }

    if (this.isUp(data)) {
      this.moveSelection(-1);
      return;
    }

    if (this.isDown(data)) {
      this.moveSelection(1);
      return;
    }

    if (matchesKey(data, "pageUp")) {
      this.moveSelection(-MAX_VISIBLE_LINES);
      return;
    }

    if (matchesKey(data, "pageDown")) {
      this.moveSelection(MAX_VISIBLE_LINES);
      return;
    }

    if (matchesKey(data, "space")) {
      this.toggleSelectedHook();
      return;
    }

    if (matchesKey(data, "g")) {
      this.draft = toggleAllPermissionHooks(this.draft, this.hooks);
      this.requestRender();
    }
  }

  // Pi routes pointer input to overlays in fullscreen mode only. The wheel
  // moves the selection rather than the window, because clampScroll derives
  // scrollOffset from the selection on every render and would undo it.
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "press") this.pressedHook = undefined;
    if (this.pressedHook === undefined) {
      const hit =
        this.legendRow?.row === event.y
          ? legendHitAt(this.legendRow.hits, event.x - CONTENT_X)
          : undefined;
      const legend = this.legendPointer.handleMouse(event, hit);
      if (legend) return legend;
    }
    if (event.button !== "left" && event.type !== "wheel") return undefined;

    // Press reveals the hook's detail; the toggle lands on release, so pressing
    // and sliding off abandons it. Assigned on every press, so an abandoned
    // gesture cannot leak its hook into some later click.
    if (event.type === "press") {
      this.pressedHook = this.hookAt(event);
      if (this.pressedHook === undefined) return undefined;
      return { handled: true, focus: true, render: this.selectTo(this.pressedHook) };
    }

    if (event.type === "click" && this.pressedHook !== undefined) {
      const index = this.pressedHook;
      this.pressedHook = undefined;
      this.selectTo(index);
      this.toggleSelectedHook();
      return { handled: true };
    }

    if (event.type === "wheel" && this.hooks.length > 0) {
      const delta = event.wheelDelta ?? 0;
      if (delta === 0) return undefined;
      return { handled: true, render: this.moveSelection(delta < 0 ? -1 : 1) };
    }

    return undefined;
  }

  /** The hook a press can act on: a hook row, in the list pane's own columns. */
  private hookAt(event: TuiMouseEvent): number | undefined {
    // A hook row spans the whole modal, but everything right of the divider
    // belongs to the detail pane.
    if (event.x < CONTENT_X || event.x >= this.listCellEndX) return undefined;
    return this.hookRows.get(event.y);
  }

  render(width: number): string[] {
    this.hookRows.clear();
    this.legendRow = undefined;
    const modalWidth = Math.max(20, Math.min(100, width));
    const innerWidth = modalWidth - 2;
    const bodyWidth = innerWidth - 2;
    const border = (text: string) => this.theme.fg("border", text);
    const row = (content = "") => border("│") + padRight(` ${content}`, innerWidth) + border("│");
    const lines = [border(`╭${"─".repeat(innerWidth)}╮`)];

    lines.push(row(this.renderHeader(bodyWidth)));
    lines.push(row());

    if (this.hooks.length === 0) {
      lines.push(row(this.theme.fg("muted", "No permission hooks loaded")));
      lines.push(row());
      const emptyLegend = this.renderLegend(bodyWidth, "");
      this.legendRow = { row: lines.length, hits: emptyLegend.hits };
      lines.push(row(emptyLegend.text));
      lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
      return lines;
    }

    const listWidth = Math.min(MAX_LIST_PANE_WIDTH, Math.floor((bodyWidth - 3) / 2));
    const detailWidth = bodyWidth - listWidth - 3;
    const listLines = this.buildListLines();
    const windowSize = Math.min(MAX_VISIBLE_LINES, listLines.length);
    this.clampScroll(listLines, windowSize);

    const visible = listLines.slice(this.scrollOffset, this.scrollOffset + windowSize);
    const rail =
      listLines.length > windowSize
        ? this.renderScrollRail(listLines.length, windowSize)
        : undefined;
    const listRows = visible.map((line, index) =>
      this.renderListLine(line, rail?.[index], listWidth),
    );

    const selectedHook = this.hooks[this.selectedIndex];
    const detailRows = selectedHook ? this.renderDetail(selectedHook, detailWidth) : [];

    this.listCellEndX = CONTENT_X + (rail ? listWidth - 2 : listWidth);
    const divider = this.theme.fg("border", "│");
    for (let index = 0; index < Math.max(listRows.length, detailRows.length); index++) {
      const listLine = visible[index];
      if (listLine?.kind === "hook") this.hookRows.set(lines.length, listLine.index);
      const left = padRight(listRows[index] ?? "", listWidth);
      lines.push(row(`${left} ${divider} ${detailRows[index] ?? ""}`));
    }

    lines.push(row());
    const legend = this.renderLegend(bodyWidth, this.renderPosition(visible, listLines.length));
    this.legendRow = { row: lines.length, hits: legend.hits };
    lines.push(row(legend.text));
    lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
    return lines;
  }

  invalidate(): void {}
  dispose(): void {}

  private renderHeader(width: number): string {
    const status = getPermissionEnablementStatus(this.hooks, this.draft);
    const left = this.theme.fg("accent", this.theme.bold("Permissions"));
    const right = this.theme.fg("muted", `${status.active}/${status.total} active`);
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width, "…", true);
  }

  private buildListLines(): ListLine[] {
    const lines: ListLine[] = [];
    let lastSource: PermissionSource | undefined;

    for (const [index, hook] of this.hooks.entries()) {
      if (hook.source !== lastSource) {
        if (lastSource !== undefined) lines.push({ kind: "blank" });
        lines.push({ kind: "label", source: hook.source });
        lastSource = hook.source;
      }
      lines.push({ kind: "hook", hook, index });
    }

    return lines;
  }

  private renderListLine(line: ListLine, railChar: string | undefined, width: number): string {
    const cellWidth = railChar === undefined ? width : width - 2;
    let cell: string;

    if (line.kind === "blank") {
      cell = " ".repeat(cellWidth);
    } else if (line.kind === "label") {
      const label = this.theme.fg(this.sourceColor(line.source), formatSourceLabel(line.source));
      const dashes = Math.max(0, cellWidth - visibleWidth(label) - 1);
      cell = padRight(`${label} ${this.theme.fg("border", "╌".repeat(dashes))}`, cellWidth);
    } else {
      const selected = line.index === this.selectedIndex;
      const cursor = selected ? this.theme.fg("accent", "›") : " ";
      const enabled = isPermissionHookEnabled(this.draft, line.hook);
      const dot = enabled ? this.theme.fg("success", "●") : this.theme.fg("warning", "○");
      const name = selected ? this.theme.fg("accent", line.hook.name) : line.hook.name;
      cell = padRight(truncateToWidth(`${cursor} ${dot} ${name}`, cellWidth, "…", true), cellWidth);
      if (selected) cell = this.theme.bg("selectedBg", cell);
    }

    return railChar === undefined ? cell : `${cell} ${railChar}`;
  }

  private renderDetail(hook: RuntimePermissionHook, width: number): string[] {
    const rows = [
      this.theme.fg("accent", this.theme.bold(truncateToWidth(hook.name, width, "…", true))),
      this.theme.fg(
        "muted",
        truncateToWidth(`${formatSourceLabel(hook.source)} · ${hook.modulePath}`, width, "…", true),
      ),
      "",
    ];

    for (const line of wrapTextWithAnsi(hook.description, Math.max(8, width))) {
      rows.push(this.theme.fg("text", line));
    }

    return rows;
  }

  private renderScrollRail(totalLines: number, windowSize: number): string[] {
    const thumbLength = Math.max(1, Math.round((windowSize / totalLines) * windowSize));
    const maxOffset = totalLines - windowSize;
    const thumbStart = Math.round(
      (this.scrollOffset / Math.max(1, maxOffset)) * (windowSize - thumbLength),
    );
    return Array.from({ length: windowSize }, (_, index) =>
      index >= thumbStart && index < thumbStart + thumbLength
        ? this.theme.fg("dim", "█")
        : this.theme.fg("border", "│"),
    );
  }

  private renderPosition(visible: ListLine[], totalLines: number): string {
    if (totalLines <= MAX_VISIBLE_LINES) {
      return `${this.selectedIndex + 1} of ${this.hooks.length}`;
    }

    const hookIndices = visible
      .filter((line): line is Extract<ListLine, { kind: "hook" }> => line.kind === "hook")
      .map((line) => line.index);
    const first = hookIndices[0];
    const last = hookIndices[hookIndices.length - 1];
    if (first === undefined || last === undefined) {
      return `${this.selectedIndex + 1} of ${this.hooks.length}`;
    }
    return `${first + 1}–${last + 1} of ${this.hooks.length}`;
  }

  // Direction-only hints name no single action, so they carry no handler.
  private legendItems(): LegendItem[] {
    return [
      { key: "j/k ↑↓", description: "move" },
      { key: "space", description: "toggle", run: () => this.toggleSelectedHook() },
      {
        key: "g",
        description: "toggle all",
        run: () => {
          this.draft = toggleAllPermissionHooks(this.draft, this.hooks);
          this.requestRender();
        },
      },
      { key: "enter", description: "save", run: () => this.done(this.draft) },
      { key: "esc", description: "cancel", run: () => this.done(undefined) },
    ];
  }

  private renderLegend(width: number, position: string): LegendLine {
    return layoutLegend(this.theme, this.legendItems(), {
      width,
      trailing: position,
      pressedKey: this.legendPointer.pressedKey,
    });
  }

  // Origin labels borrow distinct theme hues; the theme has no dedicated
  // tokens for permission sources.
  private sourceColor(source: PermissionSource): "accent" | "customMessageLabel" | "mdHeading" {
    if (source === "user") return "accent";
    if (source === "project") return "customMessageLabel";
    return "mdHeading";
  }

  private clampScroll(listLines: ListLine[], windowSize: number): void {
    const selectedLine = listLines.findIndex(
      (line) => line.kind === "hook" && line.index === this.selectedIndex,
    );
    if (selectedLine === -1) return;

    // Reveal the section label (and its preceding blank) above the selection.
    let top = selectedLine;
    if (listLines[top - 1]?.kind === "label") top -= 1;
    if (listLines[top - 1]?.kind === "blank") top -= 1;

    this.scrollOffset = Math.min(this.scrollOffset, top);
    this.scrollOffset = Math.max(this.scrollOffset, selectedLine - windowSize + 1);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, listLines.length - windowSize));
  }

  private moveSelection(delta: number): boolean {
    if (this.hooks.length === 0) return false;

    return this.selectTo(this.selectedIndex + delta);
  }

  private selectTo(index: number): boolean {
    const next = Math.max(0, Math.min(this.hooks.length - 1, index));
    if (next === this.selectedIndex) return false;

    this.selectedIndex = next;
    this.requestRender();
    return true;
  }

  private toggleSelectedHook(): void {
    const hook = this.hooks[this.selectedIndex];
    if (!hook) return;

    this.draft = setPermissionHookEnabled(
      this.draft,
      hook,
      !isPermissionHookEnabled(this.draft, hook),
    );
    this.requestRender();
  }

  private isUp(data: string): boolean {
    return getKeybindings().matches(data, "tui.select.up") || matchesKey(data, "k");
  }

  private isDown(data: string): boolean {
    return getKeybindings().matches(data, "tui.select.down") || matchesKey(data, "j");
  }

  private isConfirm(data: string): boolean {
    return getKeybindings().matches(data, "tui.select.confirm") || matchesKey(data, "return");
  }

  private isCancel(data: string): boolean {
    return getKeybindings().matches(data, "tui.select.cancel") || matchesKey(data, "escape");
  }

  private requestRender(): void {
    this.tui.requestRender();
  }
}

export async function showPermissionsSummary(
  ctx: ExtensionCommandContext,
  hooks: RuntimePermissionHook[],
  enablement: PermissionEnablement,
): Promise<PermissionEnablement | undefined> {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    ctx.ui.notify(formatPlainSummary(hooks, enablement), "info");
    return undefined;
  }

  return ctx.ui.custom<PermissionEnablement | undefined>(
    (tui, theme, _keybindings, done) =>
      new PermissionsSummaryOverlay(tui, theme, hooks, enablement, done),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: 100,
        maxHeight: "80%",
        margin: 1,
      },
    },
  );
}
