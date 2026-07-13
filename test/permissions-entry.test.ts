import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { renderPermissionsEntry } from "../src/ui/permissions-entry.js";

const state = {
  hooks: [
    { id: "git", name: "Git mutations", source: "user", enabled: false, changed: true },
    {
      id: "deploy",
      name: "Production deployment",
      source: "project",
      enabled: true,
      changed: false,
    },
  ],
};

describe("permission state entry renderer", () => {
  it("renders a uniform compact transition", () => {
    const rendered = render(state, false);

    expect(rendered).toContain("Permissions · 1 check disabled · 1/2 active");
    expect(rendered).not.toContain("Git mutations");
  });

  it("renders the complete expanded snapshot with leading change markers", () => {
    const rendered = render(state, true);

    expect(rendered).toContain("* ○ Git mutations");
    expect(rendered).toContain("  ● Production deployment");
    expect(rendered).toContain("user");
    expect(rendered).toContain("project");
  });

  it("renders mixed transitions with uniform aggregate wording", () => {
    const rendered = render(
      {
        hooks: [
          { id: "a", name: "A", source: "user", enabled: true, changed: true },
          { id: "b", name: "B", source: "project", enabled: false, changed: true },
        ],
      },
      false,
    );

    expect(rendered).toContain("Permissions · 2 checks changed · 1/2 active");
  });

  it.each([
    { hooks: { git: false } },
    { enabled: false },
    { hooks: [] },
    undefined,
  ])("hides legacy, no-op, or malformed state %#", (data) => {
    expect(createComponent(data, false)).toBeUndefined();
  });
});

function render(data: unknown, expanded: boolean): string {
  const component = createComponent(data, expanded);
  if (!component) throw new Error("expected rendered component");
  return component.render(120).join("\n");
}

function createComponent(data: unknown, expanded: boolean) {
  return renderPermissionsEntry(
    { type: "custom", customType: "permissions", data } as never,
    { expanded },
    createTheme(),
  );
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
