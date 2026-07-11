import { matchTool, type PermissionsAPI, request } from "@thurstonsand/pi-permissions";

const GIT_COMMIT = /\bgit commit\b/;

export default function permissions(api: PermissionsAPI) {
  api.onToolUse({
    name: "git commit",
    description: "Ask before the agent creates a commit.",
    handler(input) {
      return matchTool(input.tool, {
        bash(tool) {
          if (GIT_COMMIT.test(tool.command)) {
            return request({
              guidance: "Review the commit message before approving.",
              highlight: GIT_COMMIT,
            });
          }
        },
      });
    },
  });
}
