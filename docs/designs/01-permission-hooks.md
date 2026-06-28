# Permission hooks

## Status

Draft

## Decision Summary

`@thurstonsand/pi-permissions` will package Pi tool-use permission checks as a distributable Pi extension. The extension loads user-level and trusted project-level TypeScript permission modules through a Pi-like jiti loader, then evaluates their registered tool-use hooks before Pi executes a tool. The design chooses a small TypeScript hook API over a declarative YAML policy language so authors can express simple and complex checks with the same mechanism.

## Problem Statement

The current permission gate exists as a personal chezmoi-managed Pi extension with hardcoded rules. That makes it difficult to reuse, publish, import from other permission modules, or add repo-specific checks. The package needs to preserve global safety checks while allowing repositories to add trusted local checks without weakening user-level behavior accidentally.

## Goals

- Publish `@thurstonsand/pi-permissions` as a Pi package installable from Pi settings.
- Load user-level permission modules for every session.
- Load project-level permission modules only when the project is trusted.
- Let permission modules use TypeScript and arbitrary package dependencies.
- Mirror Pi extension conventions where practical: default exported factory function, jiti loading, package discovery through `package.json` metadata.
- Keep the public hook contract ergonomic for simple tool-name checks and expressive enough for custom logic.
- Preserve the current approval/rejection behavior for interactive prompts.

## Non-Goals

- Do not introduce a YAML or JSON policy DSL in the first version.
- Do not let project permissions disable or override user-level permissions through an explicit allow decision.
- Do not auto-rewrite blocked tool calls into other tool calls.
- Do not require project permissions for basic user-level safety checks.
- Do not ship an Author-facing skill for writing permission modules until the permission API shape is stable.

## Design Decisions

### 1. Package and installation shape

The package is named `@thurstonsand/pi-permissions`. It is published as a Pi package with one extension entrypoint:

```json
{
  "pi": {
    "extensions": ["./extensions/index.ts"]
  }
}
```

The old chezmoi-managed extension should be removed only after this package can be installed from Pi settings and user-level permission modules have replaced the hardcoded rules.

### 2. Mise-first development environment

The repository uses `mise.toml` as the canonical command surface. `direnv allow` should activate mise, install the configured Node LTS runtime, and run `mise bootstrap` so local dependencies converge without extra manual steps.

Canonical commands are:

- `mise run lint`
- `mise run format`
- `mise run typecheck`
- `mise run test`
- `mise run check`

Node is pinned with the moving LTS alias. JavaScript tools remain local npm dependencies, and mise adds `node_modules/.bin` to `PATH`; tasks call `biome`, `tsc`, and `vitest` directly rather than through `npx`.

### 3. Permission module locations and discovery

User-level permission modules are loaded from:

```text
~/.pi/agent/permissions/
```

Project-level permission modules are loaded from:

```text
.pi/permissions/
```

Project-level modules load only when `ctx.isProjectTrusted()` is true. User-level modules are trusted by location and do not require a project trust check.

Discovery mirrors Pi extension discovery for this narrower resource type:

- top-level `.ts` and `.js` files are loaded directly
- subdirectories are loaded only when they contain a `package.json` with nested metadata:

```json
{
  "pi": {
    "permissions": ["./index.ts"]
  }
}
```

Subdirectory `index.ts` files are not loaded implicitly. Package directories may use arbitrary dependencies.

### 4. Permission module factory contract

A permission module default-exports a factory function that receives a `PermissionsAPI`, mirroring Pi extensions:

```ts
import type { PermissionsAPI } from "@thurstonsand/pi-permissions";

export default function permissions(api: PermissionsAPI): void {
  api.onToolUse({
    name: "large corpus direct read",
    description: "The corpus JSON is too large to inspect directly.",
    matcher: "read",
    handler(input) {
      if (input.tool.projectPath === "data/corpus.json") {
        return { decision: "request" };
      }
    },
  });
}
```

The initial API exposes `onToolUse`. The factory shape leaves room for additional registration methods without changing the module export contract.

### 5. Hook metadata and prompt text

A tool-use hook has `name` and `description` fields. These are not only metadata; they are always incorporated into request prompts.

A request decision may add prompt-specific guidance and option labels:

```ts
interface PermissionRequestPrompt {
  guidance?: string;
  approveLabel?: string;
  rejectLabel?: string;
}
```

The public contract avoids `title`, `body`, and display-surface names. Internally the UI may construct a display message from `description`, `guidance`, and tool details, but user-provided strings should keep their original names in intermediate types where practical.

The rendered request prompt uses this anatomy:

```text
! Authorization required: {name}

{description}

{guidance}

{toolName}: {tool detail}
```

`approveLabel` and `rejectLabel` customize only the option labels. The default selected choice is not configurable.

### 6. Decision model

Permission handlers return:

```ts

type PermissionDecision =
  | { decision: "block"; reason: string }
  | { decision: "request"; prompt?: PermissionRequestPrompt };
```

Handlers return `undefined` when they do not make a terminal decision.

`block` is terminal and injects its `reason` as the blocked tool result reason.

`request` is terminal and asks the Approver through the prompt UI. The request decision does not include a reason. The reason injected into context comes from the Approver's optional note, preserving the current behavior.

### 7. Evaluation order

The extension evaluates hooks in this order:

1. project-level hooks, in discovery order
2. user-level hooks, in discovery order

For each hook:

- non-matching hooks are skipped
- `undefined` continues evaluation
- `block` stops evaluation and blocks the tool
- `request` stops evaluation and prompts the Approver

This lets project-specific hazards surface before broad user-level prompts while preventing an explicit allow decision from suppressing later checks.

### 8. Matcher contract

Hooks may omit `matcher`; an omitted matcher applies to all tool calls.

Otherwise `matcher` can be:

```ts
type PermissionMatcher =
  | PermissionToolName
  | readonly PermissionToolName[]
  | ((input: PermissionInput) => boolean | Promise<boolean>);
```

String and object matchers use Pi's exact `toolName`. Functional matchers receive the full normalized permission input.

Built-in tool names should be derived from Pi's exported built-in tool call event types rather than copied as string literals. Custom tools remain supported through widened string literal matching.

### 9. Tool input model

The permission input includes session and permission-module context:

```ts
interface PermissionInput {
  cwd: string;
  permissionRoot: string;
  tool: PermissionToolInput;
}
```

`cwd` is the active Pi session working directory. `permissionRoot` is the directory containing the permission module or permission package currently handling the hook.

The public model matches on exact `toolName`; it does not introduce a separate `PermissionToolKind` abstraction. Built-in tool inputs should expose typed convenience fields such as paths or bash commands, while custom tools carry the original input as record-shaped data.

### 10. Tool matching helper

The package should provide an optional `matchTool` helper for handlers that want typed built-in branches and named custom-tool branches without repeated `if` statements:

```ts
return matchTool(input.tool, {
  read(tool) {
    if (tool.projectPath === "data/corpus.json") return { decision: "request" };
  },

  custom: {
    web_search(tool) {
      return { decision: "request" };
    },
  },
});
```

The `custom` name follows Pi's own terminology: `CustomToolCallEvent`, `CustomToolResultEvent`, and extension/custom tools.

### 11. Prompt result behavior

Prompt handling preserves the existing permission gate behavior:

- approve with no note: tool proceeds and no context is injected
- approve with note: tool proceeds and the note is injected into the tool result context
- reject with no note: tool is blocked and the turn aborts
- reject with note: tool is blocked, the note is injected as rejection context, and the turn may continue

Internally the prompt result can use:

```ts
type PermissionGateResult =
  | { kind: "allow"; note?: string }
  | { kind: "reject"; abort: boolean; note?: string };
```

### 12. Author and Approver terminology

Use distinct terms for the two human personas:

- Author: the person who writes user-level or project-level permission modules
- Approver: the person running the Pi session who sees permission prompts and approves or rejects tool use

Avoid bare “user” where it would be ambiguous.

### 13. Future permission-authoring skill

The package may eventually ship an Author-facing skill that teaches Pi how to create user-level and project-level permission modules. The skill should be designed after the extension API is implemented and stable enough to document accurately. It should explain module locations, package metadata, hook registration, matchers, decisions, prompt guidance, and local validation.

## Edge Cases & Failure Modes

- **Project is not trusted:** Project-level permission modules are not loaded; user-level permissions still load.
- **Permission module fails to load:** Notify and continue without that module. A bad policy file should not brick the agent.
- **Permission package has dependencies:** The package directory owns its dependencies, loaded through jiti in the same spirit as Pi extensions.
- **No UI is available for a request decision:** Block the tool call with a reason that permission was required but no UI was available.
- **Multiple hooks match:** The first `block` or `request` wins. `undefined` decisions do not stop evaluation.
- **Custom extension tool is called:** Match by exact `toolName`; custom inputs expose record-shaped data.

## Rejected Alternatives

### YAML policy files

A declarative YAML policy would make simple rules reviewable, but it requires designing and maintaining a policy language, schema validation, glob semantics, and shell matching behavior. TypeScript permission modules are more direct and support complex repo-specific checks without two parallel systems.

### Project-level allow decisions

An explicit allow decision would make it easy for project permissions to suppress user-level safety checks. The v1 decision model uses only terminal `block` and `request` decisions; `undefined` means the hook does not decide.

### Full prompt replacement

Letting hooks replace the entire prompt title/body would maximize flexibility but weaken consistency. Hooks always provide `name` and `description`; request decisions may add `guidance` and option labels only.

### Separate PermissionToolKind abstraction

A normalized tool kind would give pi-permissions its own categories, but Pi already exposes `toolName` and authors are likely familiar with Pi tool names. The public contract uses exact `toolName` and typed built-in input helpers instead.

## Integration Points

- Pi extension API: the package registers a global extension and intercepts `tool_call` events.
- Pi project trust: project-level permission loading is gated by `ctx.isProjectTrusted()`.
- Pi jiti loading conventions: permission modules should be loaded through jiti with no module cache, similar to Pi extensions.
- Pi package settings: the package is installed from Pi settings rather than copied through chezmoi.
- Existing chezmoi permission gate: current hardcoded rules migrate into user-level permission modules.
- mise and direnv: the repo uses mise as the canonical environment and command runner, with direnv as the entrypoint for automatic local setup.
- Future Author-facing skill: should be bundled only after the implemented permission API can be documented precisely.

## Implementation Plan

- [x] Phase 1: Repository skeleton and design record
  - Goal: Create the publishable package skeleton and capture this design before implementation.
  - Files: `package.json`, `mise.toml`, `.envrc`, `tsconfig.json`, `biome.json`, `README.md`, `RELEASE.md`, `docs/designs/01-permission-hooks.md`, release skill.
  - Work: Initialize the repo, add the no-op Pi extension entrypoint, add initial public contract placeholders, and configure the quality gate.
  - Validation: `mise bootstrap --yes`, `mise run check`, `npm pack --dry-run`.

- [x] Phase 2: Core public contract
  - Goal: Implement and test the public types, matcher evaluation, typed built-in tool input normalization, and `matchTool` helper.
  - Files: `src/` and `test/`.
  - Work: Derive built-in names from Pi exported tool call event types, normalize tool calls into permission inputs, implement matcher evaluation, and add helper tests.
  - Validation: `mise run check`.

- [x] Phase 3: Permission module loader
  - Goal: Load user-level and trusted project-level permission modules with Pi-like discovery.
  - Files: `src/loader.ts`, `src/runtime.ts`, tests with temporary permission trees.
  - Work: Discover top-level files and package dirs with `pi.permissions`, load with jiti, register hooks through `PermissionsAPI`, preserve discovery order, and notify/continue on load failures.
  - Validation: loader unit tests and `mise run check`.

- [x] Phase 4: Permission extension behavior
  - Goal: Wire the loader and evaluator into the Pi extension entrypoint.
  - Files: `extensions/index.ts`, extension surface modules, runtime/evaluator modules, UI/presentation modules.
  - Work: Intercept `tool_call`, evaluate hooks project-first then user-level, preserve current request/block behavior, and add `/permissions` summary/toggle behavior.
  - Validation: unit tests for decision behavior and a local Pi smoke test.

- [ ] Phase 5: Migrate existing rules and chezmoi integration
  - Goal: Replace the hardcoded chezmoi permission gate with installed `@thurstonsand/pi-permissions` and user-level permission modules.
  - Files: ansiblonomicon chezmoi/Pi settings and `~/.pi/agent/permissions` source equivalents.
  - Work: Move current hardcoded rules into user permission modules, install the package through Pi settings, and remove the old extension copy.
  - Validation: local Pi smoke tests for git mutation, recursive forced removal, SQL mutation, and project-specific permission behavior.

- [ ] Phase 6: Author-facing permission skill
  - Goal: Ship a package-provided skill that helps Authors create permission modules after the API stabilizes.
  - Files: package skill directory, README/API docs, examples.
  - Work: Document module locations, package metadata, hook registration, matcher forms, decisions, prompt guidance, and validation workflow.
  - Validation: Use the skill to author a real project-level permission module and verify it with a local Pi smoke test.
