import type { PendingToolResultNote } from "./presentation.js";

export class PendingApprovalNotes {
  private readonly byToolCallId = new Map<string, PendingToolResultNote[]>();

  rememberForToolResult(toolCallId: string, ...notes: PendingToolResultNote[]): void {
    this.byToolCallId.set(toolCallId, [...(this.byToolCallId.get(toolCallId) ?? []), ...notes]);
  }

  consumeForToolResult(toolCallId: string): PendingToolResultNote[] {
    const notes = this.byToolCallId.get(toolCallId) ?? [];
    this.byToolCallId.delete(toolCallId);
    return notes;
  }

  discardOutstandingNotes(): void {
    this.byToolCallId.clear();
  }
}
