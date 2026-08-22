import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForOverlaysToClear } from "../src/ui/overlay-gate.js";

type WidgetFactory = (tui: TUI, theme: unknown) => Component;

function harness(options: { overlayOpen?: boolean; withTui?: boolean } = {}) {
  let overlayOpen = options.overlayOpen ?? false;
  let mounted = 0;
  let polls = 0;
  const widgetKeys: string[] = [];

  const tui = {
    hasOverlay() {
      polls += 1;
      return overlayOpen;
    },
  } as unknown as TUI;

  const ctx = {
    ui: {
      setWidget(key: string, content: WidgetFactory | undefined) {
        widgetKeys.push(key);
        if (content === undefined) {
          if (mounted > 0) mounted -= 1;
          return;
        }
        if (options.withTui !== false) {
          content(tui, {});
          mounted += 1;
        }
      },
    },
  } as unknown as ExtensionContext;

  return {
    ctx,
    polls: () => polls,
    mountedWidgets: () => mounted,
    widgetKeys: () => widgetKeys,
    setOverlayOpen: (open: boolean) => {
      overlayOpen = open;
    },
  };
}

function track(promise: Promise<void>): { settled: () => boolean } {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  return { settled: () => settled };
}

describe("overlay gate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns after a single check when no overlay is open", async () => {
    const gate = harness();

    await waitForOverlaysToClear(gate.ctx);

    expect(gate.polls()).toBe(1);
    expect(gate.mountedWidgets()).toBe(0);
  });

  it("keeps polling while an overlay is open and returns once it closes", async () => {
    const gate = harness({ overlayOpen: true });

    const waiting = track(waitForOverlaysToClear(gate.ctx));
    await vi.advanceTimersByTimeAsync(500);

    expect(waiting.settled()).toBe(false);
    expect(gate.polls()).toBeGreaterThan(3);
    expect(gate.mountedWidgets()).toBe(1);

    const pollsWhileBlocked = gate.polls();
    gate.setOverlayOpen(false);
    await vi.advanceTimersByTimeAsync(100);

    expect(waiting.settled()).toBe(true);
    expect(gate.polls()).toBeGreaterThan(pollsWhileBlocked);
    expect(gate.mountedWidgets()).toBe(0);
    expect(new Set(gate.widgetKeys()).size).toBe(1);
  });

  it("does not wait when the mode has no TUI to hand out", async () => {
    const gate = harness({ overlayOpen: true, withTui: false });

    await waitForOverlaysToClear(gate.ctx);

    expect(gate.polls()).toBe(0);
    expect(gate.mountedWidgets()).toBe(0);
  });
});
