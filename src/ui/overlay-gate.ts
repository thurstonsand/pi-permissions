import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

const OVERLAY_GATE_WIDGET_KEY = "pi-permissions:overlay-gate";
const POLL_INTERVAL_MS = 100;

// A prompt mounts in place of the editor and takes focus from whatever held it,
// but an open overlay keeps painting on top and keeps its own key legend on
// screen. The approver then answers a prompt they cannot see, and pi hands
// focus back to the overlay once the prompt closes, leaving an editor that
// accepts nothing. Wait the overlay out instead: someone is using it.
//
// pi emits no overlay lifecycle event, so hasOverlay has to be polled, and the
// TUI is only reachable from a mounted component. A widget is the inert way in:
// it never takes focus, and below the editor an empty one occupies no rows.
export async function waitForOverlaysToClear(ctx: ExtensionContext): Promise<void> {
  let tui: TUI | undefined;
  ctx.ui.setWidget(
    OVERLAY_GATE_WIDGET_KEY,
    (widgetTui) => {
      tui = widgetTui;
      return { render: () => [], invalidate() {} };
    },
    { placement: "belowEditor" },
  );

  try {
    // Modes without a live TUI never call the factory, and have no overlays.
    while (tui?.hasOverlay()) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally {
    ctx.ui.setWidget(OVERLAY_GATE_WIDGET_KEY, undefined);
  }
}
