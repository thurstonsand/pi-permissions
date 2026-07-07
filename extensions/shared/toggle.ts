import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getPermissionEnablementStatus,
  type PermissionEnablement,
  type PermissionEnablementStatus,
  type RuntimePermissionHook,
  toggleAllPermissionHooks,
} from "../../src/enablement.js";
import { persistPermissionsState } from "../../src/state.js";
import { syncPermissionsStatus } from "../../src/ui/status.js";
import type { PermissionsRuntimeState } from "../runtime.js";

export function commitEnablement(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: PermissionsRuntimeState,
  enablement: PermissionEnablement,
): PermissionEnablementStatus {
  state.enablement = enablement;
  persistPermissionsState(pi, enablement);
  syncPermissionsStatus(ctx, state.hooks, state.enablement);
  return getPermissionEnablementStatus(state.hooks, state.enablement);
}

export function applyGlobalEnablement(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: PermissionsRuntimeState,
  compute: (
    enablement: PermissionEnablement,
    hooks: readonly RuntimePermissionHook[],
  ) => PermissionEnablement,
): void {
  if (state.hooks.length === 0) {
    ctx.ui.notify("No permission hooks loaded", "info");
    return;
  }

  const status = commitEnablement(pi, ctx, state, compute(state.enablement, state.hooks));
  ctx.ui.notify(toggleMessage(status.active, status.total), status.active > 0 ? "info" : "warning");
}

export function togglePermissions(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: PermissionsRuntimeState,
): void {
  applyGlobalEnablement(pi, ctx, state, toggleAllPermissionHooks);
}

export function toggleMessage(active: number, total: number): string {
  return active > 0
    ? `Authorization active for ${active}/${total} permission checks`
    : `Authorization no longer required for ${total} permission checks... be careful`;
}
