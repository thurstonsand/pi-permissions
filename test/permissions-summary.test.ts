import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
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
