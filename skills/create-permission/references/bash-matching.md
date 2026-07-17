# Bash Matching

Treat commands as syntax, not prose. Raw regexes can match quoted strings, confuse arguments with subcommands, and miss wrappers such as `sudo` or `env`.

## Program and subcommand

Use `matchCommand()` for program/subcommand rules:

```ts
import {
  gitValueFlags,
  matchCommand,
  matchTool,
  request,
  type PermissionsAPI,
} from "@thurstonsand/pi-permissions";

const gitCommit = matchCommand({
  program: "git",
  subcommands: ["commit"],
  valueFlags: gitValueFlags,
  onMatch: ({ spans }) =>
    request({
      guidance: "Review the commit message before approving.",
      highlight: spans,
    }),
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
```

`matchCommand()`:

- parses chains, pipelines, substitutions, and known shell `-c` payloads
- resolves programs through common wrappers and variable assignments
- matches `programName` by basename
- returns every matched simple command together in one `onMatch` call
- provides `spans` for the matched program and subcommand tokens

`valueFlags` lists flags whose following value must be skipped before locating a subcommand. `gitValueFlags` covers common global Git flags such as `-C` and `--git-dir`.

`subcommandPosition: "any"` avoids maintaining value-taking flags but can create false positives by treating later positional arguments as subcommands. Prefer the default first-position behavior when precision matters.

`strict: true` converts any shell parse gap into a request, even if the target program was not found. Use it only when that broad fallback matches the policy.

## Structural predicates

Use `parseShellCommand()` when flags, argument combinations, or targets decide:

```ts
import {
  matchTool,
  parseShellCommand,
  request,
  type PermissionsAPI,
} from "@thurstonsand/pi-permissions";

export default function permissions(api: PermissionsAPI) {
  api.onToolUse({
    name: "destructive removal",
    description: "Ask before recursive forced removal.",
    async handler(input) {
      return matchTool(input.tool, {
        async bash(tool) {
          const parsed = await parseShellCommand(tool.command);
          const matches = parsed.commands.filter(
            (command) =>
              command.programName === "rm" &&
              command.hasFlag("-r", "-R", "--recursive") &&
              command.hasFlag("-f", "--force"),
          );

          if (matches.length > 0) {
            return request({ highlight: matches.map((command) => command.span) });
          }
        },
      });
    },
  });
}
```

Each `SimpleCommand` provides:

- `program` and `programName`
- `args` and leading `assignments`
- `span` for the whole invocation in the original command
- `hasFlag(...)`
- `subcommand({ valueFlags })`
- `positionals({ valueFlags })`

`parsed.hasErrors` reports parse gaps. Decide explicitly whether a gap should remain a nonmatch or force a request.

A raw-command regex remains appropriate when the policy is intentionally textual rather than structural. Scope it as tightly as possible and test quoted mentions and chained commands as near misses.

## Highlight choices

Use the token spans from `matchCommand()` when the program and subcommand alone explain the decision:

```ts
onMatch: ({ spans }) => request({ highlight: spans });
```

Use whole-command spans when flags, arguments, or targets complete the evidence:

```ts
onMatch: ({ commands }) =>
  request({ highlight: commands.map((command) => command.span) });
```

For finer evidence, `ShellToken` values are themselves spans. Filter `args` or `positionals()` and pass the selected tokens as the highlight.
