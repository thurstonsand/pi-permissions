import {
  matchCommand,
  matchTool,
  type PermissionsAPI,
  request,
  type SimpleCommand,
} from "@thurstonsand/pi-permissions";

function isDestructiveRemoval(cmd: SimpleCommand): boolean {
  return cmd.programName === "rm"
    ? cmd.hasFlag("-r", "-R", "--recursive") && cmd.hasFlag("-f", "--force")
    : cmd.hasFlag("-delete");
}

const destructiveRemoval = matchCommand({
  program: ["rm", "find"],
  where: isDestructiveRemoval,
  onMatch: ({ commands }) => request({ highlight: commands.map((cmd) => cmd.span) }),
});

export default function permissions(api: PermissionsAPI) {
  api.onToolUse({
    name: "destructive removal",
    description: "Ask before recursive forced removal or find deletion.",
    handler(input) {
      return matchTool(input.tool, { bash: destructiveRemoval });
    },
  });
}
