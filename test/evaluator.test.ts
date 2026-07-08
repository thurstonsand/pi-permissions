import { describe, expect, it } from "vitest";
import type { RegisteredPermissionHook } from "../src/api.js";
import { evaluatePermissionHooks } from "../src/evaluator.js";
import { matchTool } from "../src/match-tool.js";
import type { PermissionInput } from "../src/tool-input.js";

const readInput: PermissionInput = {
  cwd: "/repo",
  permissionRoot: "/repo/.pi/permissions",
  tool: {
    toolName: "read",
    input: { path: "data/corpus.json" },
    detail: "data/corpus.json",
    path: "data/corpus.json",
    absolutePath: "/repo/data/corpus.json",
    projectPath: "data/corpus.json",
  },
};

const bashInput: PermissionInput = {
  cwd: "/repo",
  permissionRoot: "/repo/.pi/permissions",
  tool: {
    toolName: "bash",
    input: { command: "npm test" },
    detail: "npm test",
    command: "npm test",
  },
};

describe("evaluatePermissionHooks", () => {
  it("lets handlers filter by returning undefined", async () => {
    const hooks: RegisteredPermissionHook[] = [
      {
        name: "read-only",
        description: "only blocks reads",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/read.ts",
        handler: (input) =>
          matchTool(input.tool, {
            read: () => ({ decision: "block", reason: "blocked" }),
          }),
      },
      {
        name: "fallback",
        description: "requests everything else",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/fallback.ts",
        handler: () => ({ decision: "request" }),
      },
    ];

    const result = await evaluatePermissionHooks(hooks, {
      cwd: bashInput.cwd,
      tool: bashInput.tool,
    });

    expect(result.evaluation?.hook.name).toBe("fallback");
    expect(result.evaluation?.decision).toEqual({ decision: "request" });
    expect(result.failures).toEqual([]);
  });

  it("continues after undefined and stops at the first terminal decision", async () => {
    const hooks: RegisteredPermissionHook[] = [
      {
        name: "first",
        description: "does not decide",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/first.ts",
        handler: () => undefined,
      },
      {
        name: "second",
        description: "blocks",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/second.ts",
        handler: (input) =>
          matchTool(input.tool, {
            read: () => ({ decision: "block", reason: "blocked" }),
          }),
      },
      {
        name: "third",
        description: "should not run",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/third.ts",
        handler: () => ({ decision: "request" }),
      },
    ];

    const result = await evaluatePermissionHooks(hooks, {
      cwd: readInput.cwd,
      tool: readInput.tool,
    });

    expect(result.evaluation?.hook.name).toBe("second");
    expect(result.evaluation?.decision).toEqual({ decision: "block", reason: "blocked" });
  });

  it("skips throwing hooks and reports the failures", async () => {
    const hooks: RegisteredPermissionHook[] = [
      {
        name: "broken",
        description: "throws",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/broken.ts",
        handler: () => {
          throw new Error("boom");
        },
      },
      {
        name: "decider",
        description: "continues",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/decider.ts",
        handler: () => ({ decision: "request" }),
      },
    ];

    const result = await evaluatePermissionHooks(hooks, {
      cwd: bashInput.cwd,
      tool: bashInput.tool,
    });

    expect(result.evaluation?.hook.name).toBe("decider");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.hook.name).toBe("broken");
  });
});
