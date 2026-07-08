import { afterEach, describe, expect, it } from "vitest";

import { registerPermissionHooks } from "../extensions/hooks.js";
import { getUserPermissionsDir } from "../extensions/runtime.js";
import { assignPermissionHookIds, type RuntimePermissionHook } from "../src/enablement.js";
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

describe("runtime hook notifications", () => {
  it("notifies each failing hook once per restored session", async () => {
    const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    const notifications: string[] = [];
    const hooks: RuntimePermissionHook[] = [
      {
        id: "broken#0",
        name: "broken",
        description: "throws",
        source: "user",
        permissionRoot: "/permissions",
        modulePath: "/permissions/broken.ts",
        handler: () => {
          throw new Error("boom");
        },
      },
    ];

    registerPermissionHooks(
      {
        on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
          handlers.set(event, handler);
        },
        events: { emit: () => undefined },
      } as never,
      { hooks, enablement: {} },
      { discardOutstandingNotes: () => undefined, consumeForToolResult: () => undefined } as never,
    );

    const ctx = {
      cwd: "/repo",
      hasUI: true,
      ui: { notify: (message: string) => notifications.push(message) },
    };
    const event = { toolName: "bash", input: { command: "npm test" } };

    await handlers.get("tool_call")?.(event, ctx);
    await handlers.get("tool_call")?.(event, ctx);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("Permission hook broken failed");
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
