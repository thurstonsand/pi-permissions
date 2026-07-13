import { describe, expect, it, vi } from "vitest";
import { applyGlobalEnablement, commitEnablement } from "../extensions/shared/toggle.js";
import { assignPermissionHookIds, setAllPermissionHooks } from "../src/enablement.js";

describe("permission enablement commits", () => {
  it("persists one complete snapshot only for an effective state change", () => {
    const [hook] = assignPermissionHookIds([
      {
        name: "Git mutations",
        description: "Protect reviewed git state",
        source: "user",
        permissionRoot: "/permissions",
        modulePath: "/permissions/git.ts",
        handler: () => undefined,
      },
    ]);
    if (!hook) throw new Error("expected runtime hook");

    const appendEntry = vi.fn();
    const pi = { appendEntry } as never;
    const ctx = { hasUI: false } as never;
    const state = { hooks: [hook], enablement: {} };

    const changed = commitEnablement(pi, ctx, state, { [hook.id]: false });
    const unchanged = commitEnablement(pi, ctx, state, { [hook.id]: false });

    expect(changed).toEqual({ active: 0, total: 1 });
    expect(unchanged).toBeUndefined();
    expect(appendEntry).toHaveBeenCalledTimes(1);
    expect(appendEntry).toHaveBeenCalledWith("permissions", {
      hooks: [
        {
          id: hook.id,
          name: "Git mutations",
          source: "user",
          enabled: false,
          changed: true,
        },
      ],
    });
  });

  it("uses the transcript in TUI mode and notifications in RPC mode", () => {
    const [hook] = assignPermissionHookIds([
      {
        name: "Git mutations",
        description: "Protect reviewed git state",
        source: "user",
        permissionRoot: "/permissions",
        modulePath: "/permissions/git.ts",
        handler: () => undefined,
      },
    ]);
    if (!hook) throw new Error("expected runtime hook");

    const tui = createRuntime("tui", hook);
    applyGlobalEnablement(tui.pi, tui.ctx, tui.state, disableAll);
    expect(tui.notify).not.toHaveBeenCalled();

    const rpc = createRuntime("rpc", hook);
    applyGlobalEnablement(rpc.pi, rpc.ctx, rpc.state, disableAll);
    expect(rpc.notify).toHaveBeenCalledWith(
      "Authorization no longer required for 1 permission checks... be careful",
      "warning",
    );
  });

  it("notifies when a global command makes no effective change", () => {
    const [hook] = assignPermissionHookIds([
      {
        name: "Git mutations",
        description: "Protect reviewed git state",
        source: "user",
        permissionRoot: "/permissions",
        modulePath: "/permissions/git.ts",
        handler: () => undefined,
      },
    ]);
    if (!hook) throw new Error("expected runtime hook");

    const runtime = createRuntime("tui", hook, { [hook.id]: false });
    applyGlobalEnablement(runtime.pi, runtime.ctx, runtime.state, disableAll);

    expect(runtime.notify).toHaveBeenCalledWith("Permissions unchanged", "info");
    expect(runtime.appendEntry).not.toHaveBeenCalled();
  });
});

function disableAll(
  enablement: Record<string, boolean>,
  hooks: Parameters<typeof setAllPermissionHooks>[1],
) {
  return setAllPermissionHooks(enablement, hooks, false);
}

function createRuntime(
  mode: "tui" | "rpc",
  hook: ReturnType<typeof assignPermissionHookIds>[number],
  enablement: Record<string, boolean> = {},
) {
  const appendEntry = vi.fn();
  const notify = vi.fn();
  return {
    pi: { appendEntry } as never,
    ctx: { mode, hasUI: false, ui: { notify } } as never,
    state: { hooks: [hook], enablement },
    appendEntry,
    notify,
  };
}
