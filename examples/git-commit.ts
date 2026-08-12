import {
  matchCommand,
  matchTool,
  type PermissionsAPI,
  request,
} from "@thurstonsand/pi-permissions";

const gitCommit = matchCommand({
  program: "git",
  subcommands: ["commit"],
  onMatch: () => request({ guidance: "Review the commit message before approving." }),
});

export default function permissions(api: PermissionsAPI) {
  api.onToolUse({
    name: "git commit",
    description: "Ask before the agent creates a commit.",
    handler(input) {
      return matchTool(input.tool, { bash: gitCommit });
    },
  });
}
