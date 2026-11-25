import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionGateResult, PermissionPromptView } from "./permission-prompt.js";

// The permission prompt for modes without Pi's TUI, such as RPC hosts, built
// from Pi's select dialog. Hosts like T3 Code render the title as Markdown.
export async function showDialogGate(
  ctx: ExtensionContext,
  view: PermissionPromptView,
): Promise<PermissionGateResult> {
  const { approveLabel, rejectLabel } = view.labels;
  const approveForSession = `${approveLabel}, and don't ask again this session`;
  const choice = await ctx.ui.select(
    dialogTitle(view),
    [approveLabel, approveForSession, rejectLabel],
    { blockedKind: "permission", ...(ctx.signal ? { signal: ctx.signal } : {}) },
  );

  // The turn was stopped while the dialog waited; it is already aborting.
  if (ctx.signal?.aborted) return { kind: "reject", abort: false };

  switch (choice) {
    case approveLabel:
      return { kind: "allow" };
    case approveForSession:
      return { kind: "allow", forSession: true };
    case rejectLabel:
    case undefined:
      return { kind: "reject", abort: true };
    default:
      // Hosts such as T3 Code let the approver type their own answer instead of
      // picking an option. Read it as the reason for rejecting, the direction
      // that runs nothing.
      return { kind: "reject", abort: false, note: choice.trim() };
  }
}

function dialogTitle(view: PermissionPromptView): string {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(view.detail) + 1));
  const language = view.toolName === "bash" ? "sh" : "";
  return [view.name, view.header, `${fence}${language}\n${view.detail}\n${fence}`]
    .filter(Boolean)
    .join("\n\n");
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}
