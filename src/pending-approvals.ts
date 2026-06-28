import type { ApprovalNote } from "./presentation.js";

export class PendingApprovalNotes {
  private readonly byToolCallId = new Map<string, ApprovalNote>();

  rememberForToolResult(toolCallId: string, note: ApprovalNote): void {
    this.byToolCallId.set(toolCallId, note);
  }

  consumeForToolResult(toolCallId: string): ApprovalNote | undefined {
    const note = this.byToolCallId.get(toolCallId);
    this.byToolCallId.delete(toolCallId);
    return note;
  }

  discardOutstandingNotes(): void {
    this.byToolCallId.clear();
  }
}
