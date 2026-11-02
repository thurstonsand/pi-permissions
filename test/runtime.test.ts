import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { registerPermissionHooks } from "../extensions/hooks.js";
import { getUserPermissionsDir, loadRuntimeHooks } from "../extensions/runtime.js";
import {
  assignPermissionHookIds,
  getEnabledPermissionHooks,
  isPermissionHookEnabled,
  type RuntimePermissionHook,
} from "../src/enablement.js";
import { PendingApprovalNotes } from "../src/pending-approvals.js";
import { restorePermissionsState } from "../src/state.js";

const originalUserDir = process.env.PI_PERMISSIONS_USER_DIR;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  restoreEnv("PI_PERMISSIONS_USER_DIR", originalUserDir);
  restoreEnv("PI_CODING_AGENT_DIR", originalAgentDir);
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("permission directory overrides", () => {
  it("uses a user permission directory override for smoke tests and manual validation", () => {
    process.env.PI_PERMISSIONS_USER_DIR = "/tmp/user-permissions";

    expect(getUserPermissionsDir()).toBe("/tmp/user-permissions");
  });
});

describe("project permission trust", () => {
  it("skips a project Pi trusted on its own and reports it, until /trust saves a yes", async () => {
    const { cwd, agentDir } = createProject();

    const undecided = await loadRuntimeHooks(createTrustContext(cwd, true));
    expect(undecided.hooks).toEqual([]);
    expect(undecided.skippedUntrustedProject).toBe(true);

    writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [cwd]: true }));
    const trusted = await loadRuntimeHooks(createTrustContext(cwd, true));
    expect(trusted.hooks.map((hook) => hook.name)).toEqual(["project check"]);
    expect(trusted.skippedUntrustedProject).toBe(false);
  });

  it("loads a project Pi gated and trusted itself", async () => {
    const { cwd } = createProject();
    writeFileSync(join(cwd, ".pi", "settings.json"), "{}");

    const loaded = await loadRuntimeHooks(createTrustContext(cwd, true));
    expect(loaded.hooks.map((hook) => hook.name)).toEqual(["project check"]);
  });

  it("skips a distrusted project without reporting it", async () => {
    const { cwd, agentDir } = createProject();
    writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [cwd]: false }));

    const loaded = await loadRuntimeHooks(createTrustContext(cwd, false));
    expect(loaded.hooks).toEqual([]);
    expect(loaded.skippedUntrustedProject).toBe(false);
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
        getAllTools: () => [],
      } as never,
      { hooks, enablement: {} },
      new PendingApprovalNotes(),
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
  it("restores complete hook snapshots", () => {
    const restored = restorePermissionsState(
      createContext([
        {
          hooks: [
            { id: "abc", name: "Git interference", source: "user", enabled: false, changed: true },
            { id: "def", name: "Deploy", source: "project", enabled: true, changed: false },
          ],
        },
      ]),
    );

    expect(restored).toEqual({ abc: false, def: true });
  });

  it.each([{ enabled: false }, { hooks: { abc: false } }, { hooks: [{ id: "abc" }] }])(
    "ignores legacy or malformed state $state",
    (state) => {
      expect(restorePermissionsState(createContext([state]))).toEqual({});
    },
  );

  it("ignores removed hooks, restores current hooks, and defaults new hooks enabled", () => {
    const [removed, current, added] = assignPermissionHookIds([
      createHook("Removed", "/permissions/removed.ts"),
      createHook("Current", "/permissions/current.ts"),
      createHook("Added", "/permissions/added.ts"),
    ]);
    if (!removed || !current || !added) throw new Error("expected runtime hooks");

    const restored = restorePermissionsState(
      createContext([
        {
          hooks: [
            {
              id: removed.id,
              name: removed.name,
              source: removed.source,
              enabled: false,
              changed: true,
            },
            {
              id: current.id,
              name: current.name,
              source: current.source,
              enabled: false,
              changed: true,
            },
          ],
        },
      ]),
    );
    const loaded = [current, added];

    expect(isPermissionHookEnabled(restored, current)).toBe(false);
    expect(isPermissionHookEnabled(restored, added)).toBe(true);
    expect(getEnabledPermissionHooks(loaded, restored)).toEqual([added]);
  });
});

function createProject(): { cwd: string; agentDir: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-permissions-trust-"));
  tempDirs.push(root);
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  mkdirSync(join(cwd, ".pi", "permissions"), { recursive: true });
  mkdirSync(join(root, "user"));
  mkdirSync(agentDir);
  writeFileSync(
    join(cwd, ".pi", "permissions", "check.ts"),
    `export default (api) => api.onToolUse({ name: "project check", description: "", handler: () => undefined });`,
  );
  process.env.PI_PERMISSIONS_USER_DIR = join(root, "user");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return { cwd, agentDir };
}

function createTrustContext(cwd: string, projectTrusted: boolean) {
  return { cwd, isProjectTrusted: () => projectTrusted } as never;
}

function createHook(name: string, modulePath: string) {
  return {
    name,
    description: name,
    source: "user" as const,
    permissionRoot: "/permissions",
    modulePath,
    handler: () => undefined,
  };
}

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
