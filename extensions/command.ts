import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { persistPermissionsState } from "../src/state.js";
import { showPermissionsSummary } from "../src/ui/permissions-summary.js";
import { syncPermissionsStatus } from "../src/ui/status.js";
import type { PermissionsRuntimeState } from "./runtime.js";
import { toggleMessage } from "./shared/toggle.js";

export function registerPermissionsCommand(pi: ExtensionAPI, state: PermissionsRuntimeState): void {
  pi.registerCommand("permissions", {
    description: "List or toggle permission checks",
    getArgumentCompletions(prefix) {
      const actions = ["enable", "disable"];
      const filtered = actions.filter((a) => a.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((a) => ({ value: a, label: a })) : null;
    },
    async handler(args, ctx) {
      const action = args.trim();
      switch (action) {
        case "":
          await showPermissionsSummary(ctx, state.enabled, state.hooks);
          break;
        case "enable":
        case "disable":
          state.enabled = action === "enable";
          persistPermissionsState(pi, state.enabled);
          syncPermissionsStatus(ctx, state.enabled);
          ctx.ui.notify(toggleMessage(state.enabled), state.enabled ? "info" : "warning");
          break;
        default:
          ctx.ui.notify("Usage: /permissions [enable|disable]", "warning");
      }
    },
  });
}
