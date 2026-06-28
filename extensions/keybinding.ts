import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PermissionsRuntimeState } from "./runtime.js";
import type { PermissionsSettings } from "./shared/settings.js";
import { togglePermissions } from "./shared/toggle.js";

export function registerPermissionsKeybinding(
  pi: ExtensionAPI,
  state: PermissionsRuntimeState,
  settings: PermissionsSettings,
): void {
  pi.registerShortcut(settings.toggleShortcut, {
    description: "Toggle permission checks",
    handler(ctx) {
      togglePermissions(pi, ctx, state);
    },
  });
}
