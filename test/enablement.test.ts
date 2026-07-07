import { describe, expect, it } from "vitest";
import type { RegisteredPermissionHook } from "../src/api.js";
import {
  assignPermissionHookIds,
  findPermissionHooksByName,
  getPermissionEnablementStatus,
  isPermissionHookEnabled,
  setAllPermissionHooks,
  toggleAllPermissionHooks,
} from "../src/enablement.js";

describe("permission hook enablement", () => {
  it("assigns distinct ids to duplicate hook names", () => {
    const hooks = assignPermissionHookIds([
      makeHook("Git interference", "/permissions/git.ts"),
      makeHook("Git interference", "/permissions/git.ts"),
      makeHook("Git interference", "/project/git.ts"),
    ]);

    expect(new Set(hooks.map((hook) => hook.id)).size).toBe(3);
  });

  it("defaults newly seen hooks to enabled", () => {
    const [hook] = assignPermissionHookIds([makeHook("Git interference")]);
    if (!hook) throw new Error("missing hook");

    expect(isPermissionHookEnabled({}, hook)).toBe(true);
  });

  it("sets all currently loaded hooks without affecting newly seen hooks", () => {
    const hooks = assignPermissionHookIds([makeHook("Git interference"), makeHook("Deploy")]);
    const enablement = setAllPermissionHooks({}, hooks.slice(0, 1), false);

    expect(getPermissionEnablementStatus(hooks, enablement)).toEqual({ active: 1, total: 2 });
  });

  it("global toggle disables mixed state and enables all-off state", () => {
    const hooks = assignPermissionHookIds([makeHook("Git interference"), makeHook("Deploy")]);
    const mixed = setAllPermissionHooks({}, hooks.slice(0, 1), false);
    const allOff = toggleAllPermissionHooks(mixed, hooks);
    const allOn = toggleAllPermissionHooks(allOff, hooks);

    expect(getPermissionEnablementStatus(hooks, mixed)).toEqual({ active: 1, total: 2 });
    expect(getPermissionEnablementStatus(hooks, allOff)).toEqual({ active: 0, total: 2 });
    expect(getPermissionEnablementStatus(hooks, allOn)).toEqual({ active: 2, total: 2 });
  });

  it("finds hooks by exact case-insensitive name", () => {
    const hooks = assignPermissionHookIds([makeHook("Git interference"), makeHook("Deploy")]);

    expect(findPermissionHooksByName(hooks, "git interference").map((hook) => hook.name)).toEqual([
      "Git interference",
    ]);
    expect(findPermissionHooksByName(hooks, "Git")).toEqual([]);
  });
});

function makeHook(name: string, modulePath = "/permissions/rules.ts"): RegisteredPermissionHook {
  return {
    name,
    description: `${name} description`,
    source: "user",
    permissionRoot: "/permissions",
    modulePath,
    handler: () => undefined,
  };
}
