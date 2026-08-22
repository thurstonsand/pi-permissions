import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPermissionHooks } from "../extensions/hooks.js";
import {
  assignPermissionHookIds,
  isPermissionHookEnabled,
  setPermissionHookEnabled,
} from "../src/enablement.js";
import { PendingApprovalNotes } from "../src/pending-approvals.js";
import { type PermissionGateResult, showPermissionGate } from "../src/ui/permission-prompt.js";

vi.mock("../src/ui/permission-prompt.js", () => ({ showPermissionGate: vi.fn() }));

describe("don't ask again outcomes", () => {
  it("approves the call and disables the deciding hook for the session branch", async () => {
    const runtime = createRuntime({ kind: "allow", forSession: true });

    const result = await runtime.toolCall();

    expect(result).toBeUndefined();
    expect(isPermissionHookEnabled(runtime.state.enablement, runtime.hook)).toBe(false);
    expect(runtime.appendEntry).toHaveBeenCalledWith("permissions", {
      hooks: [
        {
          id: runtime.hook.id,
          name: "Git mutations",
          source: "user",
          enabled: false,
          changed: true,
        },
      ],
    });
    expect(runtime.notifications).toEqual([
      "Authorization no longer required (Git mutations)... be careful",
    ]);
    expect(runtime.statuses).toEqual(["permissions:0/1"]);
  });

  it("relays the approval note alongside the disable", async () => {
    const runtime = createRuntime({ kind: "allow", forSession: true, note: "it is fine" });

    await runtime.toolCall();

    expect(runtime.notifications).toEqual([
      `Operation authorized (Git mutations)

Authorization log:
it is fine`,
      "Authorization no longer required (Git mutations)... be careful",
    ]);
    expect(runtime.pendingApprovalNotes.consumeForToolResult("call-1")).toEqual({
      kind: "approval",
      hookName: "Git mutations",
      note: "it is fine",
    });
  });

  it("leaves the hook enabled for a plain approval", async () => {
    const runtime = createRuntime({ kind: "allow" });

    await runtime.toolCall();

    expect(isPermissionHookEnabled(runtime.state.enablement, runtime.hook)).toBe(true);
    expect(runtime.appendEntry).not.toHaveBeenCalled();
    expect(runtime.notifications).toEqual([]);
  });
});

describe("pending request lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces the request and holds the prompt until the screen clears", async () => {
    const runtime = createRuntime({ kind: "allow" }, { overlayOpen: true, deferPrompt: true });
    const toolCall = runtime.toolCall();

    await vi.advanceTimersByTimeAsync(500);
    expect(runtime.workingMessages).toEqual(["Requesting permission for Git mutations..."]);
    expect(runtime.attentionEvents).toEqual([["request", "call-1"]]);
    expect(showPermissionGate).not.toHaveBeenCalled();

    runtime.setOverlayOpen(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(showPermissionGate).toHaveBeenCalledTimes(1);

    // The gate widget is the wait's own scaffolding and goes as soon as the
    // screen clears; the announcement and the attention ping belong to the
    // request and outlive it, all the way through an unanswered prompt.
    expect(runtime.promptSnapshot()).toEqual({
      mountedWidgets: 0,
      workingMessages: ["Requesting permission for Git mutations..."],
      attentionEvents: [["request", "call-1"]],
    });

    runtime.resolvePrompt();
    await expect(toolCall).resolves.toBeUndefined();
    expect(runtime.workingMessages).toEqual([
      "Requesting permission for Git mutations...",
      undefined,
    ]);
    expect(runtime.attentionEvents).toEqual([
      ["request", "call-1"],
      ["resolve", "call-1"],
    ]);
    expect(runtime.mountedWidgets()).toBe(0);
  });

  it("retracts the request when the deciding hook is disabled before the screen clears", async () => {
    const runtime = createRuntime({ kind: "allow" }, { overlayOpen: true, deferPrompt: true });
    const toolCall = runtime.toolCall();

    await vi.advanceTimersByTimeAsync(500);
    runtime.state.enablement = setPermissionHookEnabled(
      runtime.state.enablement,
      runtime.hook,
      false,
    );
    runtime.setOverlayOpen(false);
    await vi.advanceTimersByTimeAsync(100);

    await expect(toolCall).resolves.toBeUndefined();
    expect(showPermissionGate).not.toHaveBeenCalled();
    expect(runtime.workingMessages).toEqual([
      "Requesting permission for Git mutations...",
      undefined,
    ]);
    expect(runtime.attentionEvents).toEqual([
      ["request", "call-1"],
      ["resolve", "call-1"],
    ]);
    expect(runtime.mountedWidgets()).toBe(0);
  });

  it("prompts immediately when no overlay is open", async () => {
    const runtime = createRuntime({ kind: "allow" }, { deferPrompt: true });
    const toolCall = runtime.toolCall();

    await vi.advanceTimersByTimeAsync(0);
    expect(showPermissionGate).toHaveBeenCalledTimes(1);

    runtime.resolvePrompt();
    await expect(toolCall).resolves.toBeUndefined();
  });
});

function createRuntime(
  result: PermissionGateResult,
  options: { overlayOpen?: boolean; deferPrompt?: boolean } = {},
) {
  let overlayOpen = options.overlayOpen ?? false;
  let releasePrompt: (() => void) | undefined;
  let promptSnapshot: unknown;

  vi.mocked(showPermissionGate).mockReset();
  vi.mocked(showPermissionGate).mockImplementation(() => {
    promptSnapshot = {
      mountedWidgets: mounted,
      workingMessages: [...workingMessages],
      attentionEvents: [...attentionEvents],
    };
    if (!options.deferPrompt) return Promise.resolve(result);
    return new Promise<PermissionGateResult>((resolve) => {
      releasePrompt = () => resolve(result);
    });
  });

  const [hook] = assignPermissionHookIds([
    {
      name: "Git mutations",
      description: "Protect reviewed git state",
      source: "user",
      permissionRoot: "/permissions",
      modulePath: "/permissions/git.ts",
      handler: () => ({ decision: "request" as const }),
    },
  ]);
  if (!hook) throw new Error("expected runtime hook");

  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const notifications: string[] = [];
  const statuses: string[] = [];
  const workingMessages: (string | undefined)[] = [];
  const attentionEvents: [string, string][] = [];
  const tui = { hasOverlay: () => overlayOpen } as unknown as TUI;
  let mounted = 0;
  const appendEntry = vi.fn();
  const state = { hooks: [hook], enablement: {} };
  const pendingApprovalNotes = new PendingApprovalNotes();

  registerPermissionHooks(
    {
      on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers.set(event, handler);
      },
      appendEntry,
      events: {
        emit: (name: string, payload: { attentionId: string }) => {
          attentionEvents.push([name.slice(name.lastIndexOf(":") + 1), payload.attentionId]);
        },
      },
    } as never,
    state,
    pendingApprovalNotes,
  );

  const ctx = {
    cwd: "/repo",
    mode: "tui",
    hasUI: true,
    sessionManager: { getBranch: () => [] },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      notify: (message: string) => notifications.push(message),
      setStatus: (_key: string, value: string) => statuses.push(value),
      setWidget: (_key: string, content: ((tui: TUI, theme: unknown) => unknown) | undefined) => {
        if (content === undefined) {
          mounted -= 1;
          return;
        }
        content(tui, {});
        mounted += 1;
      },
      setWorkingMessage: (message?: string) => workingMessages.push(message),
    },
  };

  return {
    hook,
    state,
    appendEntry,
    notifications,
    statuses,
    pendingApprovalNotes,
    workingMessages,
    attentionEvents,
    mountedWidgets: () => mounted,
    promptSnapshot: () => promptSnapshot,
    setOverlayOpen: (open: boolean) => {
      overlayOpen = open;
    },
    resolvePrompt: () => {
      if (!releasePrompt) throw new Error("prompt was never mounted");
      releasePrompt();
    },
    toolCall: () =>
      handlers.get("tool_call")?.(
        { toolCallId: "call-1", toolName: "read", input: { path: "a.ts" } },
        ctx,
      ),
  };
}
