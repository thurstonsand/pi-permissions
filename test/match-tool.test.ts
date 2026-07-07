import { describe, expect, it } from "vitest";
import { matchTool } from "../src/match-tool.js";
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
