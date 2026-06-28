import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function syncPermissionsStatus(ctx: ExtensionContext, enabled: boolean): void {
  if (!ctx.hasUI) return;

  ctx.ui.setStatus(
    "permissions",
    enabled
      ? ctx.ui.theme.fg("accent", "permissions:on")
      : ctx.ui.theme.fg("warning", "permissions:off"),
  );
}
