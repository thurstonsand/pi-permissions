import type { PendingToolResultNote } from "./presentation.js";

export class PendingApprovalNotes {
  private readonly byToolCallId = new Map<string, PendingToolResultNote>();

  rememberForToolResult(toolCallId: string, note: PendingToolResultNote): void {
    this.byToolCallId.set(toolCallId, note);
  }

  consumeForToolResult(toolCallId: string): PendingToolResultNote | undefined {
    const note = this.byToolCallId.get(toolCallId);
    this.byToolCallId.delete(toolCallId);
    return note;
  }

  discardOutstandingNotes(): void {
    this.byToolCallId.clear();
  }
}
