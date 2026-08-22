import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PendingRequestAnnouncement {
  end(): void;
}

// A request is invisible to the approver until its prompt mounts, and the
// prompt can be parked for as long as someone leaves an overlay open. pi's
// working line is the one row that stays visible for the whole tool call, so
// the request claims it from the moment it is raised until it is answered.
//
// pi offers no way to read the working message back, so end() restores pi's
// default rather than whatever another extension may have set.
export function announcePendingRequest(
  ctx: ExtensionContext,
  message: string,
): PendingRequestAnnouncement {
  ctx.ui.setWorkingMessage(ctx.ui.theme.fg("accent", message));

  let ended = false;
  return {
    end() {
      if (ended) return;
      ended = true;
      ctx.ui.setWorkingMessage();
    },
  };
}
