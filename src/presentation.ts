import type { PermissionRequestPrompt } from "./api.js";
import { highlightSpans } from "./highlight.js";

export type ApprovalNote = {
  hookName: string;
  note: string;
};

export type PermissionPromptInput = {
  hookName: string;
  description: string;
  toolName: string;
  toolDetail: string;
  prompt?: PermissionRequestPrompt;
};

export type PermissionPromptEmphasis = (fragment: string) => string;

function formatDecisionLog(label: string, note: string): string {
  return `${label}:
${note}`;
}

export function formatHumanFacingApprovalNotification({ hookName, note }: ApprovalNote): string {
  return `Operation authorized (${hookName})

${formatDecisionLog("Authorization log", note)}`;
}

export function formatHumanFacingRejectionNotification(hookName: string, note?: string): string {
  const aborted = `Operation aborted (${hookName})`;
  return note
    ? `${aborted}

${formatDecisionLog("Abort log", note)}`
    : aborted;
}

export function formatHumanFacingPermissionPrompt(
  input: PermissionPromptInput,
  emphasize: PermissionPromptEmphasis = identity,
): {
  name: string;
  message: string;
  approveLabel: string;
  rejectLabel: string;
} {
  const detail = formatToolDetail(input, emphasize);
  const message = [input.description, input.prompt?.guidance, detail]
    .filter((part) => part && part.trim().length > 0)
    .join("\n\n");

  return {
    name: `! Authorization required: ${input.hookName}`,
    message,
    approveLabel: input.prompt?.approveLabel ?? "Authorize",
    rejectLabel: input.prompt?.rejectLabel ?? "Abort",
  };
}

function identity(fragment: string): string {
  return fragment;
}

function formatToolDetail(
  input: PermissionPromptInput,
  emphasize: PermissionPromptEmphasis,
): string {
  return `${input.toolName}: ${formatHighlightedDetail(
    input.toolDetail,
    input.prompt?.highlight,
    emphasize,
  )}`;
}

function formatHighlightedDetail(
  detail: string,
  highlight: PermissionRequestPrompt["highlight"],
  emphasize: PermissionPromptEmphasis,
): string {
  if (!highlight) return detail;

  const spans = highlightSpans(detail, highlight);
  if (spans.length === 0) return detail;

  let cursor = 0;
  let output = "";

  for (const span of spans) {
    output += detail.slice(cursor, span.start);
    output += emphasizePerLine(detail.slice(span.start, span.end), emphasize);
    cursor = span.end;
  }

  return output + detail.slice(cursor);
}

// A single emphasized fragment must never span a newline: the theme's foreground
// color is applied once and is not re-opened per line, so the prompt overlay
// (which splits on newlines) would drop the color on every line after the first.
function emphasizePerLine(fragment: string, emphasize: PermissionPromptEmphasis): string {
  return fragment
    .split("\n")
    .map((line) => (line ? emphasize(line) : line))
    .join("\n");
}

export function formatAgentFacingApprovalNote({ hookName, note }: ApprovalNote): string {
  return `Approved by user via permission hook ${hookName}

The user approved this tool use and provided additional context for how to proceed:
${note}`;
}

export function formatAgentFacingBlockReason(hookName: string, reason: string): string {
  return `Blocked by permission hook ${hookName}

${reason}`;
}

export function formatAgentFacingNoUiReason(input: PermissionPromptInput): string {
  return `Blocked ${input.toolName} (${input.hookName}): user confirmation required but no UI available.`;
}

export function formatAgentFacingRejectionReason(hookName: string, note?: string): string {
  const blocked = `Blocked by user via permission hook ${hookName}`;
  if (!note) return blocked;

  return `${blocked}

The user doesn't want to proceed with this tool use, and it was rejected. To proceed, the user said:
${note}`;
}
