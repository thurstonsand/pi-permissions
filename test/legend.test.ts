import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { LegendPointer, layoutLegend, legendHitAt } from "../src/ui/legend.js";

function mount() {
  const run = vi.fn();
  const requestRender = vi.fn();
  const pointer = new LegendPointer(requestRender);
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => `\x1b[44m${text}\x1b[49m`,
  } as unknown as Theme;
  const items = [
    { key: "↑↓", description: "move" },
    { key: "esc", description: "cancel", run },
  ];
  const render = (width = 40) =>
    layoutLegend(theme, items, { width, pressedKey: pointer.pressedKey });
  const mouse = (
    type: TuiMouseEvent["type"],
    x: number,
    button: TuiMouseEvent["button"] = "left",
  ) =>
    pointer.handleMouse(
      {
        type,
        button,
        x,
        y: 0,
        screenX: x,
        screenY: 0,
        width: 40,
        height: 1,
        shift: false,
        alt: false,
        ctrl: false,
      },
      legendHitAt(render().hits, x),
    );
  return { run, requestRender, pointer, render, mouse, items };
}

describe("legend press feedback", () => {
  it("highlights exactly the actionable text, not direction hints or separators", () => {
    const h = mount();
    for (const x of [0, 6, 7, 8, 19, 39]) {
      expect(h.mouse("press", x)).toBeUndefined();
      expect(h.render().text).not.toContain("\x1b[44m");
    }
    for (const x of [9, 18]) {
      expect(h.mouse("press", x)).toEqual({ handled: true });
      expect(h.render().text).toContain("↑↓ move  \x1b[44mesc cancel\x1b[49m");
    }
    expect(h.run).not.toHaveBeenCalled();
  });

  it("retains the pressed callback through release and a changed legend", () => {
    const h = mount();
    h.mouse("press", 9);
    const replacement = vi.fn();
    h.items[1] = { key: "enter", description: "save", run: replacement };
    expect(h.mouse("release", 9)).toEqual({ handled: true, render: true });
    expect(h.pointer.pressedKey).toBeUndefined();
    h.mouse("click", 9);
    expect(h.run).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it("clears abandoned presses, including non-primary presses, without claiming padding", () => {
    const h = mount();
    for (const button of ["left", "right", "middle"] as const) {
      h.mouse("press", 9);
      expect(h.mouse("press", 0, button)).toBeUndefined();
      expect(h.pointer.pressedKey).toBeUndefined();
      h.mouse("click", 0);
    }
    expect(h.requestRender).toHaveBeenCalledTimes(3);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("drops a dragged gesture and clears its highlight", () => {
    const h = mount();
    h.mouse("press", 9);
    expect(h.mouse("drag", 0)).toEqual({ handled: true });
    expect(h.pointer.pressedKey).toBeUndefined();
    expect(h.mouse("release", 0)).toBeUndefined();
    expect(h.mouse("click", 0)).toBeUndefined();
    expect(h.run).not.toHaveBeenCalled();
  });

  it("does not highlight or register a hint truncated by the available width", () => {
    const h = mount();
    h.mouse("press", 9);
    const line = h.render(15);
    expect(line.hits).toEqual([]);
    expect(line.text).not.toContain("\x1b[44m");
  });

  it("leaves wheel, motion, and secondary buttons unhandled", () => {
    const h = mount();
    for (const type of ["wheel", "move", "release"] as const) {
      expect(h.mouse(type, 9)).toBeUndefined();
    }
    expect(h.mouse("press", 9, "right")).toBeUndefined();
    expect(h.mouse("click", 9, "right")).toBeUndefined();
    expect(h.run).not.toHaveBeenCalled();
  });
});
