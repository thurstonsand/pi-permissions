import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { getEnabledPermissionHooks } from "../src/enablement.js";
import { evaluatePermissionHooks } from "../src/evaluator.js";
import type { PendingApprovalNotes } from "../src/pending-approvals.js";
import {
  formatAgentFacingApprovalNote,
  formatAgentFacingBlockReason,
  formatAgentFacingNoUiReason,
  formatAgentFacingRejectionReason,
  formatHumanFacingApprovalNotification,
  formatHumanFacingPermissionPrompt,
  formatHumanFacingRejectionNotification,
  type PermissionPromptInput,
} from "../src/presentation.js";
import { restorePermissionsState } from "../src/state.js";
import { permissionToolInputFromToolCall } from "../src/tool-input.js";
import { type PermissionGateResult, showPermissionGate } from "../src/ui/permission-prompt.js";
import { syncPermissionsStatus } from "../src/ui/status.js";
import { loadRuntimeHooks, notifyLoadErrors, type PermissionsRuntimeState } from "./runtime.js";

export function registerPermissionHooks(
  pi: ExtensionAPI,
  state: PermissionsRuntimeState,
  pendingApprovalNotes: PendingApprovalNotes,
): void {
  async function restoreSession(ctx: ExtensionContext): Promise<void> {
    pendingApprovalNotes.discardOutstandingNotes();
    const loaded = await loadRuntimeHooks(ctx);
    state.hooks = loaded.hooks;
    state.enablement = restorePermissionsState(ctx, state.hooks);
    syncPermissionsStatus(ctx, state.hooks, state.enablement);
    notifyLoadErrors(ctx, loaded.errors);
  }

  pi.on("session_start", async (_event, ctx) => restoreSession(ctx));
  pi.on("session_tree", async (_event, ctx) => restoreSession(ctx));
  pi.on("session_before_fork", async (_event, ctx) => restoreSession(ctx));
  pi.on("turn_end", () => pendingApprovalNotes.discardOutstandingNotes());

  pi.on("tool_result", async (event) => {
    const approval = pendingApprovalNotes.consumeForToolResult(event.toolCallId);
    if (!approval) return undefined;

    return {
      content: [
        {
          type: "text" as const,
          text: formatAgentFacingApprovalNote(approval),
        },
        ...event.content,
      ],
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    const evaluation = await evaluatePermissionHooks(
      getEnabledPermissionHooks(state.hooks, state.enablement),
      {
        cwd: ctx.cwd,
        tool: permissionToolInputFromToolCall(event, ctx.cwd),
      },
    );
    if (!evaluation) return undefined;

    const { hook, input, decision } = evaluation;

    if (decision.decision === "block") {
      return { block: true, reason: formatAgentFacingBlockReason(hook.name, decision.reason) };
    }

    const promptInput: PermissionPromptInput = {
      hookName: hook.name,
      description: hook.description,
      toolName: input.tool.toolName,
      toolDetail: input.tool.detail,
      ...(decision.prompt ? { prompt: decision.prompt } : {}),
    };

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: formatAgentFacingNoUiReason(promptInput),
      };
    }

    const prompt = formatHumanFacingPermissionPrompt(promptInput, (fragment) =>
      ctx.ui.theme.fg("warning", ctx.ui.theme.bold(fragment)),
    );
    pi.events.emit("glimpseui:attention:request", {
      attentionId: event.toolCallId,
      label: hook.name,
    });

    let result: Awaited<ReturnType<typeof showPermissionGate>>;
    try {
      result = await showPermissionGate(ctx, prompt.name, prompt.message, {
        approveLabel: prompt.approveLabel,
        rejectLabel: prompt.rejectLabel,
      });
    } finally {
      pi.events.emit("glimpseui:attention:resolve", { attentionId: event.toolCallId });
    }

    return handlePromptResult(ctx, event, hook.name, result, pendingApprovalNotes);
  });
}

function handlePromptResult(
  ctx: ExtensionContext,
  event: ToolCallEvent,
  hookName: string,
  result: PermissionGateResult,
  pendingApprovalNotes: PendingApprovalNotes,
): { block: true; reason: string } | undefined {
  switch (result.kind) {
    case "allow":
      if (result.note) {
        ctx.ui.notify(
          formatHumanFacingApprovalNotification({ hookName, note: result.note }),
          "warning",
        );
        pendingApprovalNotes.rememberForToolResult(event.toolCallId, {
          hookName,
          note: result.note,
        });
      }
      return undefined;
    case "reject": {
      const reason = formatAgentFacingRejectionReason(hookName, result.note);
      ctx.ui.notify(formatHumanFacingRejectionNotification(hookName, result.note), "warning");
      if (result.abort) {
        setTimeout(() => ctx.abort(), 0);
      }
      return { block: true, reason };
    }
  }
}
