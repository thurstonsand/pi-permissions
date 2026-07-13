import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerPermissionsCommand } from "../extensions/command.js";
import { assignPermissionHookIds } from "../src/enablement.js";

function createState() {
  return {
    hooks: assignPermissionHookIds([
      {
        name: "Git mutations",
        description: "Protect reviewed git state",
        source: "user",
        permissionRoot: "/permissions",
        modulePath: "/permissions/git.ts",
        handler: () => undefined,
      },
    ]),
    enablement: {},
  };
}

describe("permissions command", () => {
  it("shows the plain summary and does not commit in RPC mode", async () => {
    const state = createState();
    const { handler, appendEntry } = register(state);
    const notify = vi.fn();

    await handler("", {
      mode: "rpc",
      hasUI: true,
      ui: { notify },
    } as unknown as ExtensionCommandContext);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toContain("Permission checks active: 1/1");
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("commits a TUI modal result without a duplicate notification", async () => {
    const state = createState();
    const hook = state.hooks[0];
    if (!hook) throw new Error("expected runtime hook");
    const { handler, appendEntry } = register(state);
    const notify = vi.fn();

    await handler("", {
      mode: "tui",
      hasUI: true,
      ui: {
        custom: vi.fn().mockResolvedValue({ [hook.id]: false }),
        notify,
        setStatus: vi.fn(),
        theme: { fg: (_color: string, text: string) => text },
      },
    } as unknown as ExtensionCommandContext);

    expect(appendEntry).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});

function register(state: ReturnType<typeof createState>) {
  let handler: ((args: string, ctx: ExtensionCommandContext) => Promise<void>) | undefined;
  const appendEntry = vi.fn();
  const pi = {
    appendEntry,
    registerCommand(
      _name: string,
      options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
    ) {
      handler = options.handler;
    },
  };

  registerPermissionsCommand(pi as never, state);
  if (!handler) throw new Error("permissions command was not registered");
  return { pi, handler, appendEntry };
}
