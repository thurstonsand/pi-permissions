import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPermissionHooks } from "../extensions/hooks.js";
import {
  assignPermissionHookIds,
  isPermissionHookEnabled,
  setPermissionHookEnabled,
} from "../src/enablement.js";
import { PendingApprovalNotes } from "../src/pending-approvals.js";
import type { PermissionInput } from "../src/tool-input.js";
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
    expect(runtime.pendingApprovalNotes.consumeForToolResult("call-1")).toEqual([
      {
        kind: "approval",
        hookName: "Git mutations",
        note: "it is fine",
      },
    ]);
  });

  it("leaves the hook enabled for a plain approval", async () => {
    const runtime = createRuntime({ kind: "allow" });

    await runtime.toolCall();

    expect(isPermissionHookEnabled(runtime.state.enablement, runtime.hook)).toBe(true);
    expect(runtime.appendEntry).not.toHaveBeenCalled();
    expect(runtime.notifications).toEqual([]);
  });
});

describe("approval notes", () => {
  it("prepends the note to the tool result and keeps its structured content", async () => {
    const runtime = createRuntime({ kind: "allow", note: "it is fine" });

    await runtime.toolCall();
    const result = await runtime.toolResult({
      toolCallId: "call-1",
      structuredContent: { output: "output" },
    });

    expect(result).toEqual({
      content: [
        { type: "text", text: expect.stringContaining("it is fine") },
        { type: "text", text: "output" },
      ],
      structuredContent: { output: "output" },
    });
  });

  it("relays notes from nested calls on the calling tool's result", async () => {
    const runtime = createRuntime({ kind: "allow", note: "it is fine" });

    await runtime.toolCall({ toolCallId: "code-1/1", parentToolCallId: "code-1" });
    await runtime.toolCall({ toolCallId: "code-1/2", parentToolCallId: "code-1" });
    const nested = await runtime.toolResult({
      toolCallId: "code-1/1",
      parentToolCallId: "code-1",
      structuredContent: { output: "output" },
    });
    await runtime.toolResult({ toolCallId: "code-1/2", parentToolCallId: "code-1" });
    const parent = (await runtime.toolResult({ toolCallId: "code-1" })) as {
      content: { text: string }[];
    };

    expect(nested).toBeUndefined();
    expect(parent.content.map((block) => block.text)).toEqual([
      expect.stringContaining("it is fine"),
      expect.stringContaining("it is fine"),
      "output",
    ]);
  });

  it("relays rejections of nested calls on the calling tool's result", async () => {
    const runtime = createRuntime({ kind: "reject", abort: false, note: "not yet" });

    const blocked = await runtime.toolCall({ toolCallId: "code-1/1", parentToolCallId: "code-1" });
    const parent = (await runtime.toolResult({ toolCallId: "code-1" })) as {
      content: { text: string }[];
    };

    expect(blocked).toEqual({ block: true, reason: expect.stringContaining("not yet") });
    expect(parent.content.map((block) => block.text)).toEqual([
      expect.stringMatching(/^Blocked by user via permission hook .*not yet/s),
      "output",
    ]);
  });
});

describe("tool annotations", () => {
  it("hands the tool's annotations to permission hooks", async () => {
    const runtime = createRuntime(
      { kind: "allow" },
      {
        tools: [
          { name: "mcp__docs__search", annotations: { readOnlyHint: true } },
          { name: "read" },
        ],
      },
    );

    await runtime.toolCall({ toolName: "mcp__docs__search", input: { query: "x" } });
    await runtime.toolCall();

    expect(runtime.seenInputs.map((input) => input.tool.annotations)).toEqual([
      { readOnlyHint: true },
      undefined,
    ]);
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
  options: {
    overlayOpen?: boolean;
    deferPrompt?: boolean;
    tools?: { name: string; annotations?: object }[];
  } = {},
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

  const seenInputs: PermissionInput[] = [];
  const [hook] = assignPermissionHookIds([
    {
      name: "Git mutations",
      description: "Protect reviewed git state",
      source: "user",
      permissionRoot: "/permissions",
      modulePath: "/permissions/git.ts",
      handler: (input: PermissionInput) => {
        seenInputs.push(input);
        return { decision: "request" as const };
      },
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
      getAllTools: () => options.tools ?? [],
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
    seenInputs,
    toolCall: (event: object = {}) =>
      handlers.get("tool_call")?.(
        { toolCallId: "call-1", toolName: "read", input: { path: "a.ts" }, ...event },
        ctx,
      ),
    toolResult: (event: object) =>
      handlers.get("tool_result")?.({ content: [{ type: "text", text: "output" }], ...event }, ctx),
  };
}
