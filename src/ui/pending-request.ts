import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PendingRequestAnnouncement {
  end(): void;
}

// A request is invisible to the approver until its prompt mounts, and the
// prompt can be parked for as long as someone leaves an overlay open. pi's
// working line is the one row that stays visible for the whole tool call, so
// the request claims it from the moment it is raised until it is answered.
//
// Concurrent requests stack their prompts newest first, so the line follows
// the newest request still pending. pi offers no way to read the working
// message back, so the last request to end restores pi's default rather than
// whatever another extension may have set.
export class PendingRequests {
  private readonly pending: { message: string }[] = [];

  announce(ctx: ExtensionContext, message: string): PendingRequestAnnouncement {
    const request = { message };
    this.pending.push(request);
    ctx.ui.setWorkingMessage(ctx.ui.theme.fg("accent", message));

    let ended = false;
    return {
      end: () => {
        if (ended) return;
        ended = true;
        this.pending.splice(this.pending.indexOf(request), 1);
        const newest = this.pending.at(-1);
        ctx.ui.setWorkingMessage(newest && ctx.ui.theme.fg("accent", newest.message));
      },
    };
  }
}
