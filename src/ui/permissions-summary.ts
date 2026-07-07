import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  getKeybindings,
  matchesKey,
  type TUI,
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

const MAX_VISIBLE_LINES = 12;
const MAX_LIST_PANE_WIDTH = 30;

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

  render(width: number): string[] {
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
      lines.push(row(this.renderLegend(bodyWidth, "")));
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

    const divider = this.theme.fg("border", "│");
    for (let index = 0; index < Math.max(listRows.length, detailRows.length); index++) {
      const left = padRight(listRows[index] ?? "", listWidth);
      lines.push(row(`${left} ${divider} ${detailRows[index] ?? ""}`));
    }

    lines.push(row());
    lines.push(row(this.renderLegend(bodyWidth, this.renderPosition(visible, listLines.length))));
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

  private renderLegend(width: number, position: string): string {
    const left = [
      this.hint("j/k ↑↓", "move"),
      this.hint("space", "toggle"),
      this.hint("g", "toggle all"),
      this.hint("enter", "save"),
      this.hint("esc", "cancel"),
    ].join("  ");
    const right = this.theme.fg("dim", position);
    const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
    return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width, "…", true);
  }

  private hint(key: string, description: string): string {
    return this.theme.fg("dim", key) + this.theme.fg("muted", ` ${description}`);
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

  private moveSelection(delta: number): void {
    if (this.hooks.length === 0) return;

    this.selectedIndex = Math.max(0, Math.min(this.hooks.length - 1, this.selectedIndex + delta));
    this.requestRender();
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
