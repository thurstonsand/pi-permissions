import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPermissionHooks } from "../extensions/hooks.js";
import type { PermissionDecision } from "../src/api.js";
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
      expect.stringMatching(/^A call to read made by this tool:\nApproved .*it is fine/s),
      expect.stringMatching(/^A call to read made by this tool:\nApproved .*it is fine/s),
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
      expect.stringMatching(
        /^A call to read made by this tool:\nBlocked by user via permission hook .*not yet/s,
      ),
      "output",
    ]);
  });

  it("relays hook blocks of nested calls on the calling tool's result", async () => {
    const runtime = createRuntime(
      { kind: "allow" },
      { decision: { decision: "block", reason: "never rm" } },
    );

    const blocked = await runtime.toolCall({ toolCallId: "code-1/1", parentToolCallId: "code-1" });
    const parent = (await runtime.toolResult({ toolCallId: "code-1" })) as {
      content: { text: string }[];
    };

    expect(blocked).toEqual({ block: true, reason: expect.stringContaining("never rm") });
    expect(parent.content.map((block) => block.text)).toEqual([
      expect.stringMatching(
        /^A call to read made by this tool:\nBlocked by permission hook Git mutations.*never rm/s,
      ),
      "output",
    ]);
  });

  it("relays notes through every level of nesting", async () => {
    const runtime = createRuntime({ kind: "allow", note: "it is fine" });

    await runtime.toolCall({ toolCallId: "code-1/1/1", parentToolCallId: "code-1/1" });
    await runtime.toolResult({ toolCallId: "code-1/1/1", parentToolCallId: "code-1/1" });
    await runtime.toolResult({
      toolCallId: "code-1/1",
      toolName: "codemode",
      parentToolCallId: "code-1",
    });
    const parent = (await runtime.toolResult({ toolCallId: "code-1" })) as {
      content: { text: string }[];
    };

    expect(parent.content.map((block) => block.text)).toEqual([
      expect.stringMatching(
        /^A call to codemode made by this tool:\nA call to read made by this tool:\nApproved .*it is fine/s,
      ),
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

  it("dismisses a stacked prompt once don't ask again disables its hook", async () => {
    const runtime = createRuntime({ kind: "allow" });
    const answers: ((result: PermissionGateResult) => void)[] = [];
    const retractions: AbortSignal[] = [];
    vi.mocked(showPermissionGate).mockImplementation(
      (_ctx, _view, retract) =>
        new Promise((resolve) => {
          answers.push(resolve);
          retractions.push(retract);
          retract.addEventListener("abort", () => resolve(undefined));
        }),
    );

    const older = runtime.toolCall({ toolCallId: "call-1" });
    const newer = runtime.toolCall({ toolCallId: "call-2" });
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toHaveLength(2);

    answers[1]?.({ kind: "allow", forSession: true });

    await expect(newer).resolves.toBeUndefined();
    await expect(older).resolves.toBeUndefined();
    expect(retractions.map((signal) => signal.aborted)).toEqual([true, false]);
    expect(runtime.appendEntry).toHaveBeenCalledTimes(1);
    expect(runtime.workingMessages).toEqual([
      "Requesting permission for Git mutations...",
      "Requesting permission for Git mutations...",
      "Requesting permission for Git mutations...",
      undefined,
    ]);
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

describe("RPC mode", () => {
  const gitCommit = { toolName: "bash", input: { command: "git commit -m 'wip'" } };

  it("asks through a select whose title a host renders as Markdown", async () => {
    const runtime = createRuntime({ kind: "allow" }, { mode: "rpc" });

    const toolCall = runtime.toolCall(gitCommit);
    const dialog = await runtime.nextSelect();

    expect(dialog.title).toBe(`Authorization required: Git mutations

Protect reviewed git state

\`\`\`sh
git commit -m 'wip'
\`\`\``);
    expect(dialog.options).toEqual([
      "Authorize",
      "Authorize, and don't ask again this session",
      "Abort",
    ]);
    dialog.answer("Authorize");
    await expect(toolCall).resolves.toBeUndefined();
    expect(showPermissionGate).not.toHaveBeenCalled();
    expect(runtime.attentionEvents).toEqual([
      ["request", "call-1"],
      ["resolve", "call-1"],
    ]);
  });

  it("fences a command that contains a code fence of its own", async () => {
    const runtime = createRuntime({ kind: "allow" }, { mode: "rpc" });

    void runtime.toolCall({ toolName: "bash", input: { command: "printf '```'" } });
    const dialog = await runtime.nextSelect();

    expect(dialog.title).toContain("\n\n````sh\nprintf '```'\n````");
  });

  it("disables the hook when the approver says not to ask again", async () => {
    const runtime = createRuntime({ kind: "allow" }, { mode: "rpc" });

    const toolCall = runtime.toolCall(gitCommit);
    (await runtime.nextSelect()).answer("Authorize, and don't ask again this session");

    await expect(toolCall).resolves.toBeUndefined();
    expect(isPermissionHookEnabled(runtime.state.enablement, runtime.hook)).toBe(false);
  });

  it("rejects with a typed answer as the note, without aborting the turn", async () => {
    const runtime = createRuntime({ kind: "allow" }, { mode: "rpc" });

    const toolCall = runtime.toolCall(gitCommit);
    (await runtime.nextSelect()).answer("  stage it yourself first  ");

    await expect(toolCall).resolves.toEqual({
      block: true,
      reason: `Blocked by user via permission hook Git mutations

The user doesn't want to proceed with this tool use, and it was rejected. To proceed, the user said:
stage it yourself first`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.abort).not.toHaveBeenCalled();
  });

  it("aborts the turn when the dialog is cancelled", async () => {
    const runtime = createRuntime({ kind: "allow" }, { mode: "rpc" });

    const toolCall = runtime.toolCall(gitCommit);
    (await runtime.nextSelect()).answer(undefined);

    await expect(toolCall).resolves.toEqual({
      block: true,
      reason: "Blocked by user via permission hook Git mutations",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.abort).toHaveBeenCalledTimes(1);
  });

  it("settles an unanswered request when the turn is stopped, without aborting again", async () => {
    const runtime = createRuntime({ kind: "allow" }, { mode: "rpc" });

    const toolCall = runtime.toolCall(gitCommit);
    await runtime.nextSelect();
    runtime.stopTurn();

    await expect(toolCall).resolves.toEqual({
      block: true,
      reason: "Blocked by user via permission hook Git mutations",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.abort).not.toHaveBeenCalled();
  });

  it("asks nothing for a hook disabled while its request was still being decided", async () => {
    let releaseDecision: (() => void) | undefined;
    const runtime = createRuntime(
      { kind: "allow" },
      {
        mode: "rpc",
        decide: (input) =>
          input.tool.toolName === "bash" && input.tool.detail === "slow"
            ? new Promise((resolve) => {
                releaseDecision = () => resolve({ decision: "request" });
              })
            : { decision: "request" },
      },
    );

    const slow = runtime.toolCall({
      toolName: "bash",
      input: { command: "slow" },
      toolCallId: "call-2",
    });
    const fast = runtime.toolCall(gitCommit);
    (await runtime.nextSelect()).answer("Authorize, and don't ask again this session");
    await expect(fast).resolves.toBeUndefined();
    releaseDecision?.();

    await expect(slow).resolves.toBeUndefined();
    expect(runtime.pendingSelects()).toBe(0);
  });

  it("leaves the hook's other open dialogs answerable after don't ask again", async () => {
    const runtime = createRuntime({ kind: "allow" }, { mode: "rpc" });

    const first = runtime.toolCall({ ...gitCommit, toolCallId: "call-1" });
    const second = runtime.toolCall({ ...gitCommit, toolCallId: "call-2" });
    const firstDialog = await runtime.nextSelect();
    const secondDialog = await runtime.nextSelect();
    firstDialog.answer("Authorize, and don't ask again this session");
    await expect(first).resolves.toBeUndefined();

    secondDialog.answer("Abort");

    await expect(second).resolves.toEqual({
      block: true,
      reason: "Blocked by user via permission hook Git mutations",
    });
  });
});

describe("modes without a UI", () => {
  it("blocks a request instead of asking", async () => {
    const runtime = createRuntime({ kind: "allow" }, { hasUI: false });

    const result = await runtime.toolCall();

    expect(result).toEqual({
      block: true,
      reason: "Blocked read (Git mutations): user confirmation required but no UI available.",
    });
    expect(showPermissionGate).not.toHaveBeenCalled();
    expect(runtime.attentionEvents).toEqual([]);
  });
});

function createRuntime(
  result: PermissionGateResult,
  options: {
    mode?: "tui" | "rpc";
    hasUI?: boolean;
    overlayOpen?: boolean;
    deferPrompt?: boolean;
    tools?: { name: string; annotations?: object }[];
    decision?: PermissionDecision;
    decide?: (input: PermissionInput) => PermissionDecision | Promise<PermissionDecision>;
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
        if (options.decide) return options.decide(input);
        return options.decision ?? { decision: "request" as const };
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
  const abort = vi.fn();
  const turn = new AbortController();
  const selects: SelectDialog[] = [];
  const selectWaiters: ((dialog: SelectDialog) => void)[] = [];
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
    mode: options.mode ?? "tui",
    hasUI: options.hasUI ?? true,
    abort,
    signal: turn.signal,
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
      select: (title: string, choices: string[], opts?: { signal?: AbortSignal }) =>
        new Promise<string | undefined>((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
          const dialog = { title, options: choices, answer: resolve };
          const waiter = selectWaiters.shift();
          if (waiter) waiter(dialog);
          else selects.push(dialog);
        }),
    },
  };

  return {
    hook,
    state,
    appendEntry,
    abort,
    stopTurn: () => turn.abort(),
    pendingSelects: () => selects.length,
    nextSelect: () =>
      new Promise<SelectDialog>((resolve) => {
        const dialog = selects.shift();
        if (dialog) resolve(dialog);
        else selectWaiters.push(resolve);
      }),
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
      handlers.get("tool_result")?.(
        { toolName: "read", content: [{ type: "text", text: "output" }], ...event },
        ctx,
      ),
  };
}

interface SelectDialog {
  title: string;
  options: string[];
  answer: (choice: string | undefined) => void;
}
