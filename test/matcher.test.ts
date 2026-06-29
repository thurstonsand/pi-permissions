import { describe, expect, it } from "vitest";
import type { RegisteredPermissionHook } from "../src/api.js";
import { evaluatePermissionHooks } from "../src/evaluator.js";
import { matchesPermissionInput, matchTool } from "../src/matcher.js";
import { isCustomToolInput, type PermissionInput } from "../src/tool-input.js";

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

describe("matchesPermissionInput", () => {
  it("matches exact tool names", async () => {
    await expect(matchesPermissionInput("read", readInput)).resolves.toBe(true);
    await expect(matchesPermissionInput("bash", readInput)).resolves.toBe(false);
  });

  it("matches tool name arrays and functions", async () => {
    await expect(matchesPermissionInput(["bash", "read"], readInput)).resolves.toBe(true);
    await expect(
      matchesPermissionInput((input) => input.tool.toolName === "read", readInput),
    ).resolves.toBe(true);
  });
});

describe("evaluatePermissionHooks", () => {
  it("continues after undefined and stops at the first terminal decision", async () => {
    const hooks: RegisteredPermissionHook[] = [
      {
        name: "first",
        description: "does not decide",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/first.ts",
        matcher: "read",
        handler: () => undefined,
      },
      {
        name: "second",
        description: "blocks",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/second.ts",
        matcher: "read",
        handler: () => ({ decision: "block", reason: "blocked" }),
      },
      {
        name: "third",
        description: "should not run",
        source: "user",
        permissionRoot: "/user/permissions",
        modulePath: "/user/permissions/third.ts",
        matcher: "read",
        handler: () => ({ decision: "request" }),
      },
    ];

    const result = await evaluatePermissionHooks(hooks, {
      cwd: readInput.cwd,
      tool: readInput.tool,
    });

    expect(result?.hook.name).toBe("second");
    expect(result?.decision).toEqual({ decision: "block", reason: "blocked" });
  });
});

describe("matchTool", () => {
  it("dispatches to built-in and custom tool handlers", () => {
    const readResult = matchTool(readInput.tool, {
      read: (tool) => tool.projectPath,
      default: () => "default",
    });

    const customResult = matchTool(
      { toolName: "web_search", input: { query: "pi" }, detail: "pi" },
      {
        custom: {
          web_search: (tool) => tool.toolName,
        },
        default: () => "default",
      },
    );

    expect(readResult).toBe("data/corpus.json");
    expect(customResult).toBe("web_search");
  });

  it("narrows custom tool inputs by name", () => {
    const tool = { toolName: "mcp", input: { tool: "search_web" }, detail: "search_web" };

    if (!isCustomToolInput(tool, "mcp")) {
      throw new Error("expected mcp custom tool");
    }

    expect(tool.input.tool).toBe("search_web");
  });
});
