import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { persistPermissionsState } from "../../src/state.js";
import { syncPermissionsStatus } from "../../src/ui/status.js";
import type { PermissionsRuntimeState } from "../runtime.js";

export function togglePermissions(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: PermissionsRuntimeState,
): void {
  state.enabled = !state.enabled;
  persistPermissionsState(pi, state.enabled);
  syncPermissionsStatus(ctx, state.enabled);
  ctx.ui.notify(toggleMessage(state.enabled), state.enabled ? "info" : "warning");
}

export function toggleMessage(enabled: boolean): string {
  return enabled
    ? "Authorization reinstated for this session branch"
    : "Authorization no longer required for this session branch... be careful";
}
