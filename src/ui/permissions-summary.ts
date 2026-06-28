import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { RegisteredPermissionHook } from "../api.js";

function formatHookModule(hook: RegisteredPermissionHook): string {
  return hook.modulePath;
}

function formatPlainSummary(enabled: boolean, hooks: RegisteredPermissionHook[]): string {
  const lines = [`Permission checks: ${enabled ? "enabled" : "disabled"}`, ""];

  for (const hook of hooks) {
    lines.push(`${hook.name}`);
    lines.push(`  ${hook.description}`);
    lines.push(`  ${formatHookModule(hook)}`);
  }

  lines.push("");
  lines.push("Usage: /permissions [enable|disable]");
  return lines.join("\n");
}

function formatStyledSummary(
  theme: Theme,
  enabled: boolean,
  hooks: RegisteredPermissionHook[],
): string {
  const statusLine = enabled
    ? theme.fg("success", theme.bold("Permission checks enabled"))
    : theme.fg("warning", theme.bold("Permission checks disabled"));
  const lines = [statusLine, ""];

  for (const hook of hooks) {
    lines.push(theme.fg("accent", hook.name));
    lines.push(`  ${theme.fg("dim", `↳ ${hook.description}`)}`);
    lines.push(`  ${theme.fg("muted", formatHookModule(hook))}`);
  }

  lines.push("");
  lines.push(theme.fg("muted", "Usage: /permissions [enable|disable]"));
  lines.push(theme.fg("dim", "Enter or Esc to close"));
  return lines.join("\n");
}

function padRight(content: string, width: number): string {
  return content + " ".repeat(Math.max(0, width - visibleWidth(content)));
}

class PermissionsSummaryOverlay {
  readonly width = 84;

  constructor(
    private theme: Theme,
    private enabled: boolean,
    private hooks: RegisteredPermissionHook[],
    private done: () => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "return") || matchesKey(data, "ctrl+c")) {
      this.done();
    }
  }

  render(_width: number): string[] {
    const innerWidth = this.width - 2;
    const border = (text: string) => this.theme.fg("border", text);
    const row = (content = "") => border("│") + padRight(content, innerWidth) + border("│");
    const body = formatStyledSummary(this.theme, this.enabled, this.hooks).split("\n");

    return [
      border(`╭${"─".repeat(innerWidth)}╮`),
      row(` ${this.theme.fg("accent", this.theme.bold("Permissions"))}`),
      row(),
      ...body.map((line) => row(` ${line}`)),
      border(`╰${"─".repeat(innerWidth)}╯`),
    ];
  }

  invalidate(): void {}
  dispose(): void {}
}

export async function showPermissionsSummary(
  ctx: ExtensionCommandContext,
  enabled: boolean,
  hooks: RegisteredPermissionHook[],
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(formatPlainSummary(enabled, hooks), "info");
    return;
  }

  await ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) =>
      new PermissionsSummaryOverlay(theme, enabled, hooks, () => done(undefined)),
    { overlay: true },
  );
}
