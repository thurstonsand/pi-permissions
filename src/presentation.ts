import type { PermissionRequestPrompt } from "./api.js";
import { highlightSpans } from "./highlight.js";

export type ApprovalNote = {
  hookName: string;
  note: string;
};

export type EditNote = {
  hookName: string;
  command: string;
  note?: string;
};

export type PendingToolResultNote =
  | ({ kind: "approval" } & ApprovalNote)
  | ({ kind: "edit" } & EditNote);

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

export function formatHumanFacingPermissionPrompt(input: PermissionPromptInput): {
  name: string;
  header: string;
  approveLabel: string;
  editLabel: string;
  rejectLabel: string;
} {
  const header = [input.description, input.prompt?.guidance]
    .filter((part) => part && part.trim().length > 0)
    .join("\n\n");

  return {
    name: `! Authorization required: ${input.hookName}`,
    header,
    approveLabel: input.prompt?.approveLabel ?? "Authorize",
    editLabel: input.prompt?.editLabel ?? "Edit",
    rejectLabel: input.prompt?.rejectLabel ?? "Abort",
  };
}

// The tool-detail line (`toolName: <command>`) is rendered separately from the
// prompt header so the overlay can re-derive it — and recompute highlights —
// against whatever command is current (the agent's original, or the approver's
// edit).
export function formatToolDetailLine(
  toolName: string,
  detail: string,
  highlight: PermissionRequestPrompt["highlight"],
  emphasize: PermissionPromptEmphasis = identity,
): string {
  return `${toolName}: ${formatHighlightedDetail(detail, highlight, emphasize)}`;
}

function identity(fragment: string): string {
  return fragment;
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

export function formatAgentFacingEditNote({ hookName, command, note }: EditNote): string {
  const base = `Edited by user via permission hook ${hookName}

The user edited this command before execution. The command that actually ran:
${command}`;

  if (!note) return base;

  return `${base}

The user also provided context for how to proceed:
${note}`;
}

export function formatAgentFacingToolResultNote(note: PendingToolResultNote): string {
  return note.kind === "edit"
    ? formatAgentFacingEditNote(note)
    : formatAgentFacingApprovalNote(note);
}

export function formatHumanFacingEditNotification(hookName: string): string {
  return `Command edited (${hookName})`;
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
