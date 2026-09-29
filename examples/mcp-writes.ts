import { type PermissionsAPI, request } from "@thurstonsand/pi-permissions";

export default function permissions(api: PermissionsAPI) {
  api.onToolUse({
    name: "MCP writes",
    description: "Ask before an MCP tool that is not read-only.",
    handler(input) {
      const { toolName, annotations } = input.tool;
      if (!toolName.startsWith("mcp__") || annotations?.readOnlyHint) return undefined;
      return request();
    },
  });
}
