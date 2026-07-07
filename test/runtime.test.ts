import { afterEach, describe, expect, it } from "vitest";

import { getUserPermissionsDir } from "../extensions/runtime.js";
import { assignPermissionHookIds } from "../src/enablement.js";
import { restorePermissionsState } from "../src/state.js";

const originalUserDir = process.env.PI_PERMISSIONS_USER_DIR;

afterEach(() => {
  restoreEnv("PI_PERMISSIONS_USER_DIR", originalUserDir);
});

describe("permission directory overrides", () => {
  it("uses a user permission directory override for smoke tests and manual validation", () => {
    process.env.PI_PERMISSIONS_USER_DIR = "/tmp/user-permissions";

    expect(getUserPermissionsDir()).toBe("/tmp/user-permissions");
  });
});

describe("permission state restore", () => {
  it("restores legacy disabled state as disabled loaded hooks", () => {
    const hooks = assignPermissionHookIds([
      {
        name: "Git interference",
        description: "Protect reviewed git state",
        source: "user",
        permissionRoot: "/permissions",
        modulePath: "/permissions/git.ts",
        handler: () => undefined,
      },
    ]);

    const restored = restorePermissionsState(createContext([{ enabled: false }]), hooks);

    expect(restored).toEqual({ [hooks[0]?.id ?? ""]: false });
  });

  it("restores per-hook state entries", () => {
    const restored = restorePermissionsState(createContext([{ hooks: { abc: false } }]), []);

    expect(restored).toEqual({ abc: false });
  });
});

function createContext(states: unknown[]): Parameters<typeof restorePermissionsState>[0] {
  return {
    sessionManager: {
      getBranch() {
        return states.map((data) => ({ type: "custom", customType: "permissions", data }));
      },
    },
  } as Parameters<typeof restorePermissionsState>[0];
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
