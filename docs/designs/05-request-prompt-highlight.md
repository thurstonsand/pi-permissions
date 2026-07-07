# Request prompt highlight

## Status

Accepted

Builds on design 04 (remove the permission matcher); hooks here are `name`/`description`/`handler`.

## Decision Summary

A request decision may name the offending fragment of a tool call, and the prompt renders that fragment in bold warning color so the Approver can spot it immediately. Highlights are declared on `PermissionRequestPrompt` as patterns — literal strings or RegExps — with a span-producing callback as the escape hatch when patterns cannot express the match. The tradeoff: the Author states explicitly what offended, in exchange for the framework never guessing.

## Problem Statement / Background

Only the hook knows why a tool call tripped a permission check, but the prompt shows the tool detail verbatim. When a chained bash command like `npm test && git add -A && echo done` triggers a `git add` check, the Approver has to scan the whole chain to find the fragment that caused the prompt. That costs a beat of attention on every request, precisely at the moment the extension is asking a human to make a safety judgment.

The decision surface is deliberately narrow. Design 01 rejected full prompt replacement; hooks may only add `guidance` and option labels. The framework cannot infer what offended — the handler's filtering logic is opaque code (design 04) — so the highlight must be declared explicitly by the Author on the request.

## Goals

- Let the Approver locate the offending fragment of a tool call at a glance.
- Keep the mechanism generic across tools: bash commands, file paths, and custom-tool detail strings all render through the same `detail` field.
- Add the capability as a narrow, additive extension of the existing prompt anatomy, consistent with design 01's rejection of full prompt replacement.
- Cover matches patterns cannot express through an escape hatch, without a second rendering pipeline.

## Non-Goals

- Do not highlight `description`, `guidance`, or any agent-facing message.
- Do not infer highlights automatically from handler logic or tool input.

## Exposed Shape

`PermissionRequestPrompt` gains one optional field:

```ts
interface PermissionRequestPrompt {
  guidance?: string;
  highlight?: PermissionHighlight;
  approveLabel?: string;
  rejectLabel?: string;
}

type PermissionHighlight =
  | string
  | RegExp
  | readonly (string | RegExp)[]
  | ((detail: string) => readonly HighlightSpan[]);

/** Half-open [start, end) offsets into the tool detail string. */
interface HighlightSpan {
  start: number;
  end: number;
}
```

The pattern→span engine is exported so callbacks can compose with it instead of reimplementing it:

```ts
function highlightSpans(detail: string, highlight: PermissionHighlight): HighlightSpan[];
```

A typical hook:

```ts
const GIT_MUTATION = /\bgit (add|commit|push)\b/;

api.onToolUse({
  name: "Git interference",
  description: "Git staging is reserved for the Approver.",
  handler: (input) =>
    matchTool(input.tool, {
      bash(tool) {
        if (GIT_MUTATION.test(tool.command)) {
          return request({ highlight: GIT_MUTATION });
        }
      },
    }),
});
```

The rendered prompt keeps the anatomy from design 01 §5; only the tool detail line changes, with matched fragments emphasized:

```text
! Authorization required: Git interference

Git staging is reserved for the Approver.

bash: npm test && git add -A && echo done
                  ^^^^^^^ bold, warning color
```

## Design Decisions

### 1. Declared on the request prompt

`highlight` lives on `PermissionRequestPrompt`, next to `guidance`. The handler is the only place that knows why the call offended (design 04), and highlights only matter when the handler requests — so the declaration rides on `request()`. A hook that blocks never renders a prompt and has no highlight surface.

### 2. Patterns first, spans callback as the escape hatch

The common case is a string or RegExp the handler already tested; `highlight` accepts those directly, or an array of them. Strings match as literal substrings. Every occurrence of every pattern is emphasized regardless of the RegExp `g` flag; case sensitivity is the Author's concern via the `i` flag.

When patterns cannot express the match — the same text appears twice and only one occurrence offends, or the fragment is found by parsing rather than searching — the Author passes a callback `(detail) => HighlightSpan[]` and computes the spans directly. The callback slots in at exactly the layer the engine works in: patterns are resolved to spans internally, and the callback is that resolver, swapped out.

Hand-written span literals were rejected as the primary interface — offsets written by hand are hostile to the Author and drift silently if detail formatting changes. Spans as a *callback return* do not share that flaw: they are computed at render time from the live detail string.

### 3. Highlighting applies only to the tool detail in the human-facing prompt

Patterns and callbacks are matched against `tool.detail` — the same string the prompt already renders: the verbatim command for bash, the path as the agent gave it for file tools, and the string or serialized input for custom tools. This identity is load-bearing: spans resolve against exactly what the Approver sees, so offsets cannot drift between matching and rendering. Because `detail` is the universal rendering field, the mechanism works unchanged for bash commands, file paths, and custom-tool JSON. Agent-facing messages, notifications, and the no-UI block reason are untouched; they do not carry styled text.

### 4. Bold plus warning color

Matched fragments render with the theme `warning` foreground and bold; the rest of the detail is unchanged. This is the conventional "danger here" signal and keeps the detail line quiet except at the point of interest.

### 5. Presentation stays pure; theme styling enters at the extension edge

`formatHumanFacingPermissionPrompt` gains an `emphasize: (fragment: string) => string` parameter (identity by default) and applies it to the resolved spans while assembling the message. `hooks.ts` supplies the real implementation from `ctx.ui.theme` (verified present on `ExtensionUIContext`, with `"warning"` a valid `ThemeColor`). Presentation tests use a marker function and never assert ANSI bytes. The prompt overlay needs no changes: `wrapTextWithAnsi` documents that active ANSI codes are preserved across line breaks, so a highlight spanning a wrap survives.

## Edge Cases & Failure Modes

- **No pattern matches the detail:** The detail renders unstyled. Never an error; a highlight is a rendering hint, not an assertion.
- **Overlapping or adjacent spans, from any source:** Merged into a single emphasized span.
- **Empty or inverted spans, or pattern matches of the empty string:** Skipped.
- **Callback returns out-of-range spans:** Clamped to the detail bounds; spans left empty by clamping are dropped.
- **Callback throws:** Treated as no matches; the detail renders unstyled and the prompt still shows. A rendering hint must not break the permission gate.
- **Highlight spans a wrapped line break:** Styling re-opens on the continuation line via `wrapTextWithAnsi`'s ANSI state tracking.
- **Request has no UI available:** Unchanged from design 01 — the tool is blocked with the no-UI reason; the highlight is never rendered.

## Alternatives

### Declare the highlight on the hook registration

- **Status:** Rejected
- **Decision or open issue:** A hook-level `highlight` field would be declared once next to `name` and `description`. It lost because it is static — it cannot emphasize per-call content — and it is dead weight on hooks that only block.

### Matcher returns match metadata

- **Status:** Rejected
- **Decision or open issue:** `boolean | { highlight }` from the matcher would have let the match carry its own evidence. Dissolved by design 04: the matcher no longer exists, and the discussion that surfaced this option is part of what motivated its removal.

### Hand-written span literals as the primary interface

- **Status:** Rejected
- **Decision or open issue:** Maximally precise, but offsets hardcoded by an Author are unpleasant to write and drift silently against any change in detail formatting. Spans survive only as the callback's return type, where they are computed from the live string.

### Callback returns fragments (`string[]`)

- **Status:** Rejected
- **Decision or open issue:** Easier to write than spans, but it cannot distinguish occurrences of repeated text — precisely the situation that forces an Author past patterns and into the callback.

### Callback returns a full segment partition

- **Status:** Rejected
- **Decision or open issue:** `{ text, emphasized }[]` covering the whole detail is maximally explicit, but the framework must trust or validate that segments reconcatenate to the detail — a new failure mode with no added power over spans.

### Dim the innocent parts instead

- **Status:** Rejected
- **Decision or open issue:** Muting everything except the offending fragment inverts the emphasis and arguably scans faster on long chains, but it makes the detail line read as degraded output and mutes content the Approver may still need to read — the innocent parts of a chain are part of the judgment.

## Implementation Plan

Depends on design 04 landing first; the API and examples assume matcher-less hooks.

- [ ] Phase 1: Highlight engine and presentation
  - Goal: `highlight` exists on the public contract and `formatHumanFacingPermissionPrompt` emphasizes resolved spans, with rendering still pure.
  - Files: `src/api.ts`, new `src/highlight.ts`, `src/presentation.ts`, `src/index.ts`, new `test/highlight.test.ts`, `test/presentation.test.ts`.
  - Work: Add `PermissionHighlight` and `HighlightSpan` to the API and the `highlight` field to `PermissionRequestPrompt`; implement and export `highlightSpans` with the span semantics from Edge Cases (all occurrences, literal strings, merge overlapping/adjacent, skip empty, clamp out-of-range, throwing callback yields no spans); add the `emphasize` parameter (identity default) to `formatHumanFacingPermissionPrompt` and apply it to spans in the tool detail; cover the engine and presentation with marker-function tests, never ANSI bytes.
  - Validation: `mise run check`.

- [ ] Phase 2: Theme wiring and proof
  - Goal: A real prompt renders the offending fragment in bold warning color.
  - Files: `extensions/hooks.ts`, `README.md`.
  - Work: Build the `emphasize` implementation in `hooks.ts` from `ctx.ui.theme` (bold + `warning` fg) and pass `decision.prompt.highlight` through to presentation; document the `highlight` field and the `highlightSpans` escape hatch in the README.
  - Validation: `mise run check`, plus a local Pi smoke test: a hook with `highlight` prompts on `npm test && git add -A && echo done` with `git add` visibly emphasized, including a terminal narrow enough to force the highlight across a wrapped line.
