import {
  type BashToolCallEvent,
  type ExtensionAPI,
  type ExtensionContext,
  isToolCallEventType,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import {
  getEnabledPermissionHooks,
  isPermissionHookEnabled,
  setPermissionHookEnabled,
} from "../src/enablement.js";
import { evaluatePermissionHooks, type PermissionHookFailure } from "../src/evaluator.js";
import type { PendingApprovalNotes } from "../src/pending-approvals.js";
import {
  formatAgentFacingBlockReason,
  formatAgentFacingNoUiReason,
  formatAgentFacingRejectionReason,
  formatAgentFacingToolResultNote,
  formatHumanFacingApprovalNotification,
  formatHumanFacingEditNotification,
  formatHumanFacingPendingRequestMessage,
  formatHumanFacingPermissionPrompt,
  formatHumanFacingRejectionNotification,
  formatHumanFacingSessionDisableNotification,
  type PermissionPromptInput,
} from "../src/presentation.js";
import { restorePermissionsState } from "../src/state.js";
import { permissionToolInputFromToolCall } from "../src/tool-input.js";
import { waitForOverlaysToClear } from "../src/ui/overlay-gate.js";
import { announcePendingRequest } from "../src/ui/pending-request.js";
import { type PermissionGateResult, showPermissionGate } from "../src/ui/permission-prompt.js";
import { syncPermissionsStatus } from "../src/ui/status.js";
import { loadRuntimeHooks, notifyLoadErrors, type PermissionsRuntimeState } from "./runtime.js";
import { commitEnablement } from "./shared/toggle.js";

export function registerPermissionHooks(
  pi: ExtensionAPI,
  state: PermissionsRuntimeState,
  pendingApprovalNotes: PendingApprovalNotes,
): void {
  const notifiedHookFailures = new Set<string>();

  async function restoreSession(ctx: ExtensionContext): Promise<void> {
    pendingApprovalNotes.discardOutstandingNotes();
    notifiedHookFailures.clear();
    const loaded = await loadRuntimeHooks(ctx);
    state.hooks = loaded.hooks;
    state.enablement = restorePermissionsState(ctx);
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
          text: `${formatAgentFacingToolResultNote(approval)}\n`,
        },
        ...event.content,
      ],
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    const evaluationResult = await evaluatePermissionHooks(
      getEnabledPermissionHooks(state.hooks, state.enablement),
      {
        cwd: ctx.cwd,
        tool: permissionToolInputFromToolCall(event, ctx.cwd),
      },
    );
    notifyHookFailures(ctx, evaluationResult.failures, notifiedHookFailures);
    if (!evaluationResult.evaluation) return undefined;

    const { hook, input, decision } = evaluationResult.evaluation;

    if (decision.decision === "block") {
      return {
        block: true,
        reason: formatAgentFacingBlockReason(hook.name, decision.reason),
      };
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

    const bashEvent = isToolCallEventType("bash", event) ? event : undefined;
    const editable = bashEvent ? { command: bashEvent.input.command } : undefined;

    // The pending window opens the moment the hook decides to ask and closes
    // when the approver answers, so the announcement and the attention ping
    // cover the wait for a clear screen as well as the prompt itself.
    const pending = announcePendingRequest(ctx, formatHumanFacingPendingRequestMessage(hook.name));
    pi.events.emit("glimpseui:attention:request", {
      attentionId: event.toolCallId,
      label: hook.name,
    });

    let result: Awaited<ReturnType<typeof showPermissionGate>>;
    try {
      await waitForOverlaysToClear(ctx);

      // The approver can disable the deciding hook from the pane they were in
      // when the request arrived, which retracts the question we were queued to
      // ask.
      if (!isPermissionHookEnabled(state.enablement, hook)) return undefined;

      const prompt = formatHumanFacingPermissionPrompt(promptInput);
      result = await showPermissionGate(ctx, {
        name: prompt.name,
        header: prompt.header,
        toolName: promptInput.toolName,
        detail: promptInput.toolDetail,
        ...(promptInput.prompt?.highlight !== undefined
          ? { highlight: promptInput.prompt.highlight }
          : {}),
        labels: {
          approveLabel: prompt.approveLabel,
          editLabel: prompt.editLabel,
          rejectLabel: prompt.rejectLabel,
        },
        ...(editable ? { editable } : {}),
      });
    } finally {
      pi.events.emit("glimpseui:attention:resolve", {
        attentionId: event.toolCallId,
      });
      pending.end();
    }

    const outcome = handlePromptResult(
      ctx,
      event,
      bashEvent,
      hook.name,
      result,
      pendingApprovalNotes,
    );

    if (result.kind === "allow" && result.forSession) {
      commitEnablement(pi, ctx, state, setPermissionHookEnabled(state.enablement, hook, false));
      ctx.ui.notify(formatHumanFacingSessionDisableNotification(hook.name), "warning");
    }

    return outcome;
  });
}

function notifyHookFailures(
  ctx: ExtensionContext,
  failures: readonly PermissionHookFailure[],
  notifiedHookFailures: Set<string>,
): void {
  if (!ctx.hasUI) return;
  for (const failure of failures) {
    const key = `${failure.hook.modulePath}:${failure.hook.name}`;
    if (notifiedHookFailures.has(key)) continue;
    notifiedHookFailures.add(key);

    ctx.ui.notify(
      `Permission hook ${failure.hook.name} failed: ${String(failure.error)}`,
      "warning",
    );
  }
}

function handlePromptResult(
  ctx: ExtensionContext,
  event: ToolCallEvent,
  bashEvent: BashToolCallEvent | undefined,
  hookName: string,
  result: PermissionGateResult,
  pendingApprovalNotes: PendingApprovalNotes,
): { block: true; reason: string } | undefined {
  switch (result.kind) {
    case "edit": {
      if (!bashEvent) throw new Error("edit result produced for a non-bash tool call");
      bashEvent.input.command = result.command;
      pendingApprovalNotes.rememberForToolResult(bashEvent.toolCallId, {
        kind: "edit",
        hookName,
        command: result.command,
        ...(result.note ? { note: result.note } : {}),
      });
      ctx.ui.notify(formatHumanFacingEditNotification(hookName), "warning");
      return undefined;
    }
    case "allow":
      if (result.note) {
        ctx.ui.notify(
          formatHumanFacingApprovalNotification({
            hookName,
            note: result.note,
          }),
          "warning",
        );
        pendingApprovalNotes.rememberForToolResult(event.toolCallId, {
          kind: "approval",
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
