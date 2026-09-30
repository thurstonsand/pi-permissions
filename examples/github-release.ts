import { matchTool, type PermissionsAPI, request } from "@thurstonsand/pi-permissions";

export default function permissions(api: PermissionsAPI) {
  api.onToolUse({
    name: "GitHub release",
    description: "Ask before creating a GitHub release over MCP.",
    handler(input) {
      return matchTool(input.tool, {
        custom: {
          mcp__github__create_release() {
            return request({
              guidance: "Check the tag, target repository, and release notes.",
              approveLabel: "Create release",
              rejectLabel: "Cancel release",
            });
          },
        },
      });
    },
  });
}
