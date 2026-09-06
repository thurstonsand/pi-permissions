import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { assignPermissionHookIds, type RuntimePermissionHook } from "../src/enablement.js";
import { PermissionsSummaryOverlay } from "../src/ui/permissions-summary.js";

describe("permissions summary overlay", () => {
  it("toggles a selected permission only in the draft until saved", () => {
    const done = vi.fn();
    const hooks = makeHooks(["Git interference", "Deploy"]);
    const overlay = new PermissionsSummaryOverlay(createTui(), createTheme(), hooks, {}, done);

    overlay.handleInput(" ");

    expect(done).not.toHaveBeenCalled();
    overlay.handleInput("\r");
    expect(done).toHaveBeenCalledWith({ [hooks[0]?.id ?? ""]: false });
  });

  it("cancels without returning draft changes", () => {
    const done = vi.fn();
    const overlay = new PermissionsSummaryOverlay(
      createTui(),
      createTheme(),
      makeHooks(["Git"]),
      {},
      done,
    );

    overlay.handleInput(" ");
    overlay.handleInput("\u001b");

    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("global draft toggle disables mixed state", () => {
    const done = vi.fn();
    const hooks = makeHooks(["Git", "Deploy"]);
    const overlay = new PermissionsSummaryOverlay(
      createTui(),
      createTheme(),
      hooks,
      { [hooks[0]?.id ?? ""]: false },
      done,
    );

    overlay.handleInput("g");
    overlay.handleInput("\r");

    expect(done).toHaveBeenCalledWith({
      [hooks[0]?.id ?? ""]: false,
      [hooks[1]?.id ?? ""]: false,
    });
  });

  it("renders a bounded visible list with a range counter", () => {
    const overlay = new PermissionsSummaryOverlay(
      createTui(),
      createTheme(),
      makeHooks(Array.from({ length: 20 }, (_, index) => `Hook ${index + 1}`)),
      {},
      vi.fn(),
    );

    const rendered = overlay.render(100).join("\n");

    expect(rendered).toContain("Permissions");
    expect(rendered).toContain("Hook 1");
    expect(rendered).not.toContain("Hook 20");
    expect(rendered).toContain("of 20");
  });

  it("groups hooks under origin labels in evaluation order", () => {
    const hooks = [
      ...makeHooks(["Deploy gate"], "project"),
      ...makeHooks(["Git interference"], "user"),
      ...makeHooks(["Package deploy"], "package:@cloud-guard/permissions"),
    ];
    const overlay = new PermissionsSummaryOverlay(createTui(), createTheme(), hooks, {}, vi.fn());

    const rendered = overlay.render(100).join("\n");

    const projectAt = rendered.indexOf("project ╌");
    const userAt = rendered.indexOf("user ╌");
    const packageAt = rendered.indexOf("@cloud-guard/permissions ╌");
    expect(projectAt).toBeGreaterThanOrEqual(0);
    expect(userAt).toBeGreaterThan(projectAt);
    expect(packageAt).toBeGreaterThan(userAt);
  });

  it("shows only the selected hook's detail card", () => {
    const overlay = new PermissionsSummaryOverlay(
      createTui(),
      createTheme(),
      makeHooks(["Git interference", "Deploy"]),
      {},
      vi.fn(),
    );

    const rendered = overlay.render(100).join("\n");

    expect(rendered).toContain("Git interference description");
    expect(rendered).toContain("user · /permissions/Git interference.ts");
    expect(rendered).not.toContain("Deploy description");
  });
});

describe("permissions summary overlay mouse", () => {
  const WIDTH = 100;

  function mount(names: string[], done = vi.fn()) {
    const hooks = makeHooks(names);
    const overlay = new PermissionsSummaryOverlay(createTui(), createTheme(), hooks, {}, done);
    const render = () => overlay.render(WIDTH);
    render();

    return {
      overlay,
      hooks,
      done,
      render,
      rowOf: (needle: string) => {
        const row = render().findIndex((line) => line.includes(needle));
        if (row < 0) throw new Error(`No rendered line contains ${JSON.stringify(needle)}`);
        return row;
      },
      mouse: (type: TuiMouseEvent["type"], y: number, extra?: Partial<TuiMouseEvent>) =>
        overlay.handleMouse({
          type,
          button: type === "wheel" ? "none" : "left",
          x: 4,
          y,
          screenX: 4,
          screenY: y,
          width: WIDTH,
          height: render().length,
          shift: false,
          alt: false,
          ctrl: false,
          ...extra,
        }),
    };
  }

  it("shows a hook's detail on press and toggles it on release", () => {
    const h = mount(["Git interference", "Deploy"]);
    const row = h.rowOf("● Deploy");

    expect(h.mouse("press", row)).toEqual({ handled: true, focus: true, render: true });
    expect(h.render().join("\n")).toContain("Deploy description");

    h.mouse("click", row);
    h.overlay.handleInput("\r");

    expect(h.done).toHaveBeenCalledWith({ [h.hooks[1]?.id ?? ""]: false });
  });

  it("ignores the origin label and blank rows between groups", () => {
    const hooks = [...makeHooks(["Deploy gate"], "project"), ...makeHooks(["Git"], "user")];
    const overlay = new PermissionsSummaryOverlay(createTui(), createTheme(), hooks, {}, vi.fn());
    const lines = overlay.render(WIDTH);
    const at = (needle: string) => lines.findIndex((line) => line.includes(needle));
    const event = (y: number): TuiMouseEvent => ({
      type: "click",
      button: "left",
      x: 4,
      y,
      screenX: 4,
      screenY: y,
      width: WIDTH,
      height: lines.length,
      shift: false,
      alt: false,
      ctrl: false,
    });

    expect(overlay.handleMouse(event(at("user ╌")))).toBeUndefined();
    expect(overlay.handleMouse(event(at("Permissions")))).toBeUndefined();
    expect(overlay.handleMouse(event(at("enter save")))).toBeUndefined();
  });

  it("declines a click in the detail pane sharing the row", () => {
    const h = mount(["Git interference", "Deploy"]);
    const row = h.rowOf("● Deploy");
    const detailX = h.render()[row]?.indexOf("│", 1) ?? -1;
    expect(detailX).toBeGreaterThan(0);

    expect(h.mouse("click", row, { x: detailX })).toBeUndefined();
    expect(h.mouse("click", row, { x: detailX + 4 })).toBeUndefined();
    h.overlay.handleInput("\r");

    expect(h.done).toHaveBeenCalledWith({});
  });

  it("walks the selection with the wheel and stops at the ends", () => {
    const h = mount(["One", "Two"]);

    expect(h.mouse("wheel", 4, { wheelDelta: -3 })).toEqual({ handled: true, render: false });
    expect(h.mouse("wheel", 4, { wheelDelta: 3 })).toEqual({ handled: true, render: true });
    expect(h.render().join("\n")).toContain("Two description");
  });

  it("declines the pointer over the list when no hooks are loaded", () => {
    const h = mount([]);

    expect(h.mouse("click", 3)).toBeUndefined();
    expect(h.mouse("wheel", 3, { wheelDelta: 3 })).toBeUndefined();
  });

  it("runs the legend hint that was clicked", () => {
    const toggled = mount(["Git interference", "Deploy"]);
    const row = toggled.rowOf("space toggle");
    const line = toggled.render()[row] ?? "";

    toggled.mouse("click", row, { x: line.indexOf("space toggle") });
    toggled.mouse("click", row, { x: line.indexOf("enter save") });

    expect(toggled.done).toHaveBeenCalledWith({ [toggled.hooks[0]?.id ?? ""]: false });

    const cancelled = mount(["Git interference"]);
    const cancelRow = cancelled.rowOf("esc cancel");
    const cancelLine = cancelled.render()[cancelRow] ?? "";

    cancelled.mouse("click", cancelRow, { x: cancelLine.indexOf("esc cancel") });

    expect(cancelled.done).toHaveBeenCalledWith(undefined);
  });

  it("cancels from the legend even with no hooks loaded", () => {
    const h = mount([]);
    const row = h.rowOf("esc cancel");
    const line = h.render()[row] ?? "";

    h.mouse("click", row, { x: line.indexOf("esc cancel") });

    expect(h.done).toHaveBeenCalledWith(undefined);
  });

  it("toggles the hook that was pressed, not what the scroll moved under it", () => {
    const h = mount(Array.from({ length: 20 }, (_, index) => `Hook ${index + 1}`));
    // Eleven rows down puts Hook 1 on the first visible line with its origin
    // label scrolled off. Selecting it pulls the label back into view.
    for (let index = 0; index < 11; index++) h.overlay.handleInput("j");
    h.render();

    const topRow = h.rowOf("● Hook 1 ");
    h.mouse("press", topRow);
    expect(h.render()[topRow]).toContain("user ╌");

    h.mouse("click", topRow);
    h.overlay.handleInput("\r");

    expect(h.done).toHaveBeenCalledWith({ [h.hooks[0]?.id ?? ""]: false });
  });

  it("forgets a gesture abandoned by dragging off the hook", () => {
    const h = mount(["Git interference", "Deploy"]);
    h.mouse("press", h.rowOf("● Deploy"));

    const row = h.rowOf("esc cancel");
    const line = h.render()[row] ?? "";
    h.mouse("press", row);
    h.mouse("click", row, { x: line.indexOf("esc cancel") });

    expect(h.done).toHaveBeenCalledWith(undefined);
  });

  it("leaves the move hint and the gaps between hints inert", () => {
    const h = mount(["Git interference"]);
    const row = h.rowOf("space toggle");
    const line = h.render()[row] ?? "";

    expect(h.mouse("click", row, { x: line.indexOf("j/k") })).toBeUndefined();
    expect(
      h.mouse("click", row, { x: line.indexOf("space toggle") + "space toggle".length }),
    ).toBeUndefined();
    expect(h.done).not.toHaveBeenCalled();
  });
});

function makeHooks(
  names: string[],
  source: RuntimePermissionHook["source"] = "user",
): RuntimePermissionHook[] {
  return assignPermissionHookIds(
    names.map((name) => ({
      name,
      description: `${name} description`,
      source,
      permissionRoot: "/permissions",
      modulePath: `/permissions/${name}.ts`,
      handler: () => undefined,
    })),
  );
}

function createTui(): TUI {
  return { requestRender: vi.fn() } as unknown as TUI;
}

function createTheme(): Theme {
  return {
    fg(_color: string, text: string) {
      return text;
    },
    bg(_color: string, text: string) {
      return text;
    },
    bold(text: string) {
      return text;
    },
  } as unknown as Theme;
}
