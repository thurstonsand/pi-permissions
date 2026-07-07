# Remove the permission matcher

## Status

Accepted

Supersedes design 01 §8 (matcher contract). The rest of design 01 stands.

## Decision Summary

Permission hooks drop the `matcher` field: a hook is `name`, `description`, and `handler`, and a handler that does not care about a tool call returns `undefined`. This trades the declarative tool filter — and the introspection it might someday have powered — for a single filtering idiom and a smaller public contract, at the cheapest moment the removal will ever have.

## Problem Statement / Background

The matcher and the handler can both decline a tool call, and the evaluator treats the two identically: a matcher returning `false` and a handler returning `undefined` both `continue` to the next hook (`src/evaluator.ts`). Nothing else in the codebase consults the matcher. It is not load-bearing; it is a second way to say "not my problem."

The original motivation was mirroring Claude Code's hook system rather than a need of this design. Its remaining ergonomic argument — typed, terse tool filtering — is already served better by `matchTool` inside the handler, which actually narrows the tool type for the code that uses it, something the matcher never did.

The cost of the redundancy is not hypothetical. During the design of request prompt highlights (design 05), the matcher/handler split forced a channel decision — should the matcher report what it matched? — that confused the discussion and nearly grew the matcher a metadata side channel, promoting a convenience filter into a load-bearing concept. Two idioms for one decision means every hook, and every future feature touching hooks, pays the "which side does this live on" tax.

The timing argument: design 01 defers the Author-facing skill until the API is stable, the package has one consumer, and Phase 5 (migrating the chezmoi rules into real user-level modules) has not yet multiplied the modules that would need rewriting. None of those will be true for long.

## Goals

- One filtering idiom: handlers decline by returning `undefined`.
- A smaller public hook contract before the API stabilizes and the Author-facing skill documents it.
- Preserve typed per-tool ergonomics through `matchTool`.

## Non-Goals

- No change to evaluation order, the decision model, or enablement semantics.
- No introspection features; this design deliberately forfeits that option.

## Exposed Shape

```ts
interface ToolUsePermissionHook {
  name: string;
  description: string;
  handler: PermissionHandler;
}
```

`PermissionMatcher`, `PermissionMatcherFunction`, and `matchesPermissionInput` leave the public contract. The doc-01 canonical example becomes:

```ts
api.onToolUse({
  name: "large corpus direct read",
  description: "The corpus JSON is too large to inspect directly.",
  handler: (input) =>
    matchTool(input.tool, {
      read(tool) {
        if (tool.projectPath === "data/corpus.json") return request();
      },
    }),
});
```

A hook with no filtering logic applies to every tool call, exactly as an omitted matcher does today.

## Design Decisions

### 1. Remove, not deprecate

With a single consumer and no compatibility promises, carrying a deprecated field would preserve the two-idiom problem this design exists to end. The field, its types, and its evaluation step are deleted in one change, and the existing user-level permission modules are migrated in the same effort.

### 2. `matchTool` is the blessed filtering idiom

Handlers filter with `matchTool` branches for typed built-in and custom tools, or with plain early returns when a branch helper adds nothing. `matchTool` (design 01 §10) is unchanged and becomes the primary ergonomic surface instead of a secondary helper.

### 3. The introspection option is forfeited knowingly

A declarative matcher is data; a handler is code. Dropping the matcher gives up the ability for a future `/permissions` surface to display which tools a hook watches without running it. If that feature is ever wanted, declarative coverage metadata must be reintroduced — and it should be designed for that purpose then, not preserved as dead weight now on the chance it fits.

## Edge Cases & Failure Modes

- **Hook performs no filtering:** It runs for every tool call, same as an omitted matcher today; returning `undefined` keeps evaluation moving.
- **Async filtering:** Handlers are already async-capable; nothing changes.
- **Enablement:** Unaffected; enablement filters hooks before evaluation and never consulted matchers.
- **Existing modules using `matcher`:** There are no external consumers. The Author's own modules are updated as part of this change, before Phase 5 multiplies them.

## Alternatives

### Keep the matcher as-is

- **Status:** Rejected
- **Decision or open issue:** Its entire surviving value is resemblance to Claude Code plus option value on an unbuilt introspection feature. Against that stands a demonstrated cost: two idioms for one decision, and gravitational pull toward growing the matcher side channels (design 05's discussion).

### Keep only the declarative forms, drop function matchers

- **Status:** Rejected
- **Decision or open issue:** Restricting `matcher` to tool-name strings/arrays would keep it pure data (introspectable) while removing the redundant code form. Rejected because it still leaves two places to express filtering, which is the actual problem — and the introspection feature it preserves remains unbuilt.

### Matcher returns match metadata

- **Status:** Rejected
- **Decision or open issue:** Considered during design 05 as `boolean | { highlight }`. Dissolved by this design: with no matcher, the handler is the only channel, which is where design 05 landed independently.

## Implementation Plan

- [ ] Phase 1: Remove the matcher from the public contract and runtime
  - Goal: Hooks are `name`/`description`/`handler`; the repo builds, tests, and documents only the handler-filtering idiom.
  - Files: `src/api.ts`, `src/match-tool.ts`, `src/evaluator.ts`, `src/index.ts`, `test/match-tool.test.ts`, `test/evaluator.test.ts`, other tests registering hooks with matchers, `README.md`, `CONTEXT.md`.
  - Work: Delete `PermissionMatcher`, `PermissionMatcherFunction`, and the `matcher` field from `ToolUsePermissionHook`; delete `matchesPermissionInput` and its evaluator call, rename the remaining `matchTool` helper file around its surviving purpose; rewrite matcher tests as handler-filtering coverage via `matchTool` and early returns; update README examples to the handler idiom; remove the Matcher glossary entry from `CONTEXT.md`.
  - Validation: `mise run check`.

- [ ] Phase 2: Migrate the Author's permission modules
  - Goal: The user-level modules in `~/.pi/agent/permissions` no longer pass `matcher` and behave identically.
  - Files: User-level permission modules outside this repo (chezmoi-managed).
  - Work: Move each module's matcher logic into its handler, preferring `matchTool` branches.
  - Validation: Local Pi smoke test — a chained bash command containing `git add` still raises the authorization prompt, and an innocent command does not.
