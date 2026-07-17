# Permission API

## Module contract

A permission module default-exports a factory and registers one or more hooks:

```ts
import {
  matchTool,
  request,
  type PermissionsAPI,
} from "@thurstonsand/pi-permissions";

export default function permissions(api: PermissionsAPI) {
  api.onToolUse({
    name: "production deploy",
    description: "Ask before deploying to production.",
    handler(input) {
      return matchTool(input.tool, {
        // Return request(...) or block(...) when this hook decides.
      });
    },
  });
}
```

A hook has:

- `name`: a short label shown in prompts, logs, and `/permissions`
- `description`: the stable reason shown to the Approver when the hook requests
- `handler`: receives one normalized tool call and returns a decision, a promise of one, or `undefined`

Handlers receive:

```ts
input.cwd; // current Pi working directory
input.permissionRoot; // directory containing this module or permission package
input.tool; // normalized tool input
```

Returning `undefined` means “this hook does not decide”; evaluation continues. `request()` and `block()` are terminal. Hooks run project, user, then package order and stop at the first decision.

## Decisions

Ask the Approver:

```ts
return request();
return request({
  guidance: "Check the target environment and release identifier.",
  highlight: /production|prod-db/i,
  approveLabel: "Deploy",
  editLabel: "Edit command",
  rejectLabel: "Cancel deploy",
});
```

`guidance` is request-specific advice. Keep the hook `description` stable; put details that vary by call in `guidance`. `editLabel` applies to bash requests, where Pi can open the command editor.

Block without offering approval:

```ts
return block("Generated files must be changed through the generator.");
```

The block reason is agent-facing. State the constraint that stopped the call so the agent can choose a valid next action.

## Normalized tool inputs

All tools expose `toolName`, the original `input`, and a rendered `detail`. Built-ins add convenience fields:

| Tool | Convenience fields |
| --- | --- |
| `bash` | `command` |
| `read` | `path`, `absolutePath`, `projectPath?` |
| `edit` | `path`, `absolutePath`, `projectPath?` |
| `write` | `path`, `absolutePath`, `projectPath?` |
| `grep`, `find`, `ls` | optional `path`, `absolutePath`, `projectPath` |

`projectPath` exists only when the resolved path is inside `input.cwd`; it uses forward slashes. Use `absolutePath` for filesystem identity and `projectPath` for repository-relative policy.

Branch with `matchTool()`:

```ts
return matchTool(input.tool, {
  read(tool) {
    if (tool.projectPath === ".env") {
      return block("Reading .env could expose local secrets to the model.");
    }
  },
  edit(tool) {
    if (tool.projectPath?.startsWith("generated/")) {
      return block("Run the generator instead of editing generated output.");
    }
  },
});
```

For a custom tool, match its exact registered name. `tool.input` is a `Record<string, unknown>` and `tool.detail` is the text shown in the prompt:

```ts
return matchTool(input.tool, {
  custom: {
    github_create_release(tool) {
      return request({
        guidance: `Check the repository, tag, and release notes.\n\n${tool.detail}`,
        approveLabel: "Create release",
        rejectLabel: "Cancel release",
      });
    },
  },
});
```

Use `isBashToolInput()`, `isReadToolInput()`, and the other exported narrowing helpers when direct branching is clearer than `matchTool()`.

## Highlights

Highlights resolve against `tool.detail`, exactly as rendered to the Approver. `highlight` accepts:

- a literal string
- a `RegExp`
- an array of strings and regexes
- precomputed half-open `{ start, end }` spans
- `(detail) => spans` for computed selection

Patterns emphasize every occurrence. Spans are sorted, clamped, and merged. A throwing callback or unmatched pattern produces no highlight without breaking the request.

Use parser spans when bash structure produced the verdict:

```ts
onMatch: ({ spans }) => request({ highlight: spans });

onMatch: ({ commands }) =>
  request({ highlight: commands.map((command) => command.span) });
```

Use `highlightSpans()` inside a callback when a pattern needs additional filtering:

```ts
highlight: (detail) =>
  highlightSpans(detail, /production/).filter((span) => span.start > 0),
```

Highlight all independently offending invocations in a compound call. The highlight should let the Approver answer “why did this prompt appear?” without visually overwhelming the context needed to judge it.

## Boundaries worth testing

Include explicit near misses for quoted command names, benign subcommands, path-prefix collisions, missing custom-tool fields, and alternate flag spellings when relevant.

Keep prompt labels short enough to scan. Custom labels should describe the actual outcome, not merely rename “yes” and “no.”

Use `input.permissionRoot` for assets or configuration owned by the permission package; use `input.cwd` for the active project.
