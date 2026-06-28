import type { PermissionRequestPrompt } from "./api.js";

export type ApprovalNote = {
  name: string;
  note: string;
};

export type PermissionPromptInput = {
  name: string;
  description: string;
  guidance?: string;
  toolName: string;
  toolDetail: string;
  prompt?: PermissionRequestPrompt;
};

function formatDecisionLog(label: string, note: string): string {
  return `${label}:
${note}`;
}

export function formatHumanFacingApprovalNotification({ name, note }: ApprovalNote): string {
  return `Operation authorized (${name})

${formatDecisionLog("Authorization log", note)}`;
}

export function formatHumanFacingRejectionNotification(name: string, note?: string): string {
  const aborted = `Operation aborted (${name})`;
  return note
    ? `${aborted}

${formatDecisionLog("Abort log", note)}`
    : aborted;
}

export function formatHumanFacingPermissionPrompt(input: PermissionPromptInput): {
  name: string;
  message: string;
  approveLabel: string;
  rejectLabel: string;
} {
  const message = [input.description, input.guidance, `${input.toolName}: ${input.toolDetail}`]
    .filter((part) => part && part.trim().length > 0)
    .join("\n\n");

  return {
    name: `! Authorization required: ${input.name}`,
    message,
    approveLabel: input.prompt?.approveLabel ?? "Authorize",
    rejectLabel: input.prompt?.rejectLabel ?? "Abort",
  };
}

export function formatAgentFacingApprovalNote({ name, note }: ApprovalNote): string {
  return `The user approved this tool use (${name}) and provided additional context for how to proceed:
${note}`;
}

export function formatAgentFacingBlockReason(name: string, reason: string): string {
  return `Blocked by permission rule (${name})

${reason}`;
}

export function formatAgentFacingNoUiReason(input: PermissionPromptInput): string {
  return `Blocked ${input.toolName} (${input.name}): user confirmation required but no UI available.`;
}

export function formatAgentFacingRejectionReason(name: string, note?: string): string {
  const blocked = `Blocked by user (${name})`;
  if (!note) return blocked;

  return `Blocked by user (${name})

The user doesn't want to proceed with this tool use (${name}), and it was rejected. To tell you how to proceed, the user said:
${note}`;
}
