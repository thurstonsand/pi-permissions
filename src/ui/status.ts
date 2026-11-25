import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getPermissionEnablementStatus,
  type PermissionEnablement,
  type RuntimePermissionHook,
} from "../enablement.js";

export function syncPermissionsStatus(
  ctx: ExtensionContext,
  hooks: readonly RuntimePermissionHook[],
  enablement: PermissionEnablement,
): void {
  // RPC hosts have no way to hide a status key, so the count would sit in their
  // banner on every session; it stays a TUI footer item.
  if (ctx.mode !== "tui") return;

  const status = getPermissionEnablementStatus(hooks, enablement);
  const color =
    status.total === 0 ? "muted" : status.active === status.total ? "accent" : "warning";
  ctx.ui.setStatus(
    "permissions",
    ctx.ui.theme.fg(color, `permissions:${status.active}/${status.total}`),
  );
}
