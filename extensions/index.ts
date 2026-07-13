import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PendingApprovalNotes } from "../src/pending-approvals.js";
import { PERMISSIONS_STATE_TYPE } from "../src/state.js";
import { renderPermissionsEntry } from "../src/ui/permissions-entry.js";
import { registerPermissionsCommand } from "./command.js";
import { registerPermissionHooks } from "./hooks.js";
import { registerPermissionsKeybinding } from "./keybinding.js";
import type { PermissionsRuntimeState } from "./runtime.js";
import { loadSettings } from "./shared/settings.js";

export default function permissions(pi: ExtensionAPI): void {
  const state: PermissionsRuntimeState = {
    enablement: {},
    hooks: [],
  };
  const settings = loadSettings();
  const pendingApprovalNotes = new PendingApprovalNotes();

  pi.registerEntryRenderer(PERMISSIONS_STATE_TYPE, renderPermissionsEntry);
  registerPermissionsCommand(pi, state);
  registerPermissionsKeybinding(pi, state, settings);
  registerPermissionHooks(pi, state, pendingApprovalNotes);
}
