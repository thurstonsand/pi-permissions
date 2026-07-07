import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  findPermissionHooksByName,
  formatActiveCount,
  setAllPermissionHooks,
  setPermissionHookEnabled,
} from "../src/enablement.js";
import { showPermissionsSummary } from "../src/ui/permissions-summary.js";
import type { PermissionsRuntimeState } from "./runtime.js";
import { applyGlobalEnablement, commitEnablement } from "./shared/toggle.js";

const ACTIONS = ["enable", "disable"] as const;
type PermissionAction = (typeof ACTIONS)[number];

export function registerPermissionsCommand(pi: ExtensionAPI, state: PermissionsRuntimeState): void {
  pi.registerCommand("permissions", {
    description: "List or toggle permission checks",
    getArgumentCompletions(prefix) {
      return getPermissionsArgumentCompletions(prefix, state);
    },
    async handler(args, ctx) {
      const parsed = parsePermissionsCommand(args);

      if (parsed.kind === "error") {
        ctx.ui.notify(PERMISSIONS_USAGE, "warning");
        return;
      }

      if (parsed.kind === "summary") {
        const nextEnablement = await showPermissionsSummary(ctx, state.hooks, state.enablement);
        if (!nextEnablement) return;

        const status = commitEnablement(pi, ctx, state, nextEnablement);
        ctx.ui.notify(formatActiveCount(status), "info");
        return;
      }

      if (parsed.kind === "all") {
        applyGlobalEnablement(pi, ctx, state, (enablement, hooks) =>
          setAllPermissionHooks(enablement, hooks, parsed.action === "enable"),
        );
        return;
      }

      const matches = findPermissionHooksByName(state.hooks, parsed.name);
      if (matches.length === 0) {
        ctx.ui.notify(`No permission named ${JSON.stringify(parsed.name)}`, "warning");
        return;
      }

      if (matches.length > 1) {
        ctx.ui.notify(
          `Multiple permissions named ${JSON.stringify(parsed.name)} detected; use /permissions without any arguments to choose one`,
          "warning",
        );
        return;
      }

      const hook = matches[0];
      if (!hook) return;

      commitEnablement(
        pi,
        ctx,
        state,
        setPermissionHookEnabled(state.enablement, hook, parsed.action === "enable"),
      );
      ctx.ui.notify(
        `${hook.name} ${parsed.action === "enable" ? "enabled" : "disabled"}`,
        parsed.action === "enable" ? "info" : "warning",
      );
    },
  });
}

const PERMISSIONS_USAGE = "Usage: /permissions [enable|disable [permission name]]";

type ParsedPermissionsCommand =
  | { kind: "summary" }
  | { kind: "all"; action: PermissionAction }
  | { kind: "one"; action: PermissionAction; name: string }
  | { kind: "error" };

function parsePermissionsCommand(args: string): ParsedPermissionsCommand {
  const trimmed = args.trim();
  if (!trimmed) return { kind: "summary" };

  const [action, ...nameParts] = trimmed.split(/\s+/);
  if (!isPermissionAction(action)) return { kind: "error" };

  const name = nameParts.join(" ").trim();
  return name ? { kind: "one", action, name } : { kind: "all", action };
}

function getPermissionsArgumentCompletions(
  prefix: string,
  state: PermissionsRuntimeState,
): AutocompleteItem[] | null {
  const trimmedStart = prefix.trimStart();
  const leadingWhitespace = prefix.slice(0, prefix.length - trimmedStart.length);
  const [action, ...nameParts] = trimmedStart.split(/\s+/);

  if (!trimmedStart.includes(" ")) {
    const filtered = ACTIONS.filter((candidate) => candidate.startsWith(trimmedStart));
    return filtered.length > 0
      ? filtered.map((candidate) => ({
          value: `${leadingWhitespace}${candidate}`,
          label: candidate,
        }))
      : null;
  }

  if (!isPermissionAction(action)) return null;

  const namePrefix = nameParts.join(" ").toLocaleLowerCase();
  const names = Array.from(new Set(state.hooks.map((hook) => hook.name))).sort((a, b) =>
    a.localeCompare(b),
  );
  const filtered = names.filter((name) => name.toLocaleLowerCase().startsWith(namePrefix));

  return filtered.length > 0
    ? filtered.map((name) => ({
        value: `${leadingWhitespace}${action} ${name}`,
        label: name,
      }))
    : null;
}

function isPermissionAction(value: string | undefined): value is PermissionAction {
  return value === "enable" || value === "disable";
}
