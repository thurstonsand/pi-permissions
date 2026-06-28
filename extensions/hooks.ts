import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
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
    state.enabled = restorePermissionsState(ctx);
    const loaded = await loadRuntimeHooks(ctx);
    state.hooks = loaded.hooks;
    syncPermissionsStatus(ctx, state.enabled);
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
    if (!state.enabled) return undefined;

    const evaluation = await evaluatePermissionHooks(state.hooks, {
      cwd: ctx.cwd,
      tool: permissionToolInputFromToolCall(event, ctx.cwd),
    });
    if (!evaluation) return undefined;

    const { hook, input, decision } = evaluation;

    if (decision.decision === "block") {
      return { block: true, reason: formatAgentFacingBlockReason(hook.name, decision.reason) };
    }

    const promptInput: PermissionPromptInput = {
      name: hook.name,
      description: hook.description,
      ...(decision.prompt?.guidance ? { guidance: decision.prompt.guidance } : {}),
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

    const prompt = formatHumanFacingPermissionPrompt(promptInput);
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
  name: string,
  result: PermissionGateResult,
  pendingApprovalNotes: PendingApprovalNotes,
): { block: true; reason: string } | undefined {
  switch (result.kind) {
    case "allow":
      if (result.note) {
        ctx.ui.notify(
          formatHumanFacingApprovalNotification({ name, note: result.note }),
          "warning",
        );
        pendingApprovalNotes.rememberForToolResult(event.toolCallId, { name, note: result.note });
      }
      return undefined;
    case "reject": {
      const reason = formatAgentFacingRejectionReason(name, result.note);
      ctx.ui.notify(formatHumanFacingRejectionNotification(name, result.note), "warning");
      if (result.abort) {
        setTimeout(() => ctx.abort(), 0);
      }
      return { block: true, reason };
    }
  }
}
