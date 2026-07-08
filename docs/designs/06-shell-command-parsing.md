# Shell command parsing

## Status

Accepted

## Decision Summary

`pi-permissions` internalizes a real bash parser — `tree-sitter-bash` running on `web-tree-sitter` — and exposes a two-layer authoring API: a `parseShellCommand` foundation that returns span-carrying simple commands, and a `matchCommand` sugar layer for the common program+subcommand rule. The tradeoff: two runtime dependencies and an async parse, in exchange for structural correctness (quotes, chains, substitutions, wrappers) and rules that produce their detection verdict and highlight spans in a single pass.

## Problem Statement / Background

Authors writing bash rules today run regexes over the raw command string, and the failure modes are structural, not cosmetic:

- `git status && echo "i want to add something"` trips a git-mutation regex because quoted text is indistinguishable from code.
- `git grep add` trips the same regex because "any tokens between `git` and `add`" cannot express "the subcommand position".
- `command git add` sails through because the regex anchors on `git` being the program, and wrapper prefixes aren't modeled.
- The one rule that does tokenize correctly (recursive-forced `rm`) exists as two near-identical ~40-line functions — one returning a boolean for detection, one returning spans for the highlight — because nothing ties detection to highlighting.

Every author who wants correct behavior must hand-roll a quote-aware, chain-splitting, span-preserving tokenizer. That is a library-shaped problem: solve it once, underneath the authoring API.

Design 05 established that highlights are declared explicitly by the Author. This design makes the correct declaration cheap: the same parse that decides also highlights.

## Goals

- Quoted text is inert: string contents never match program, subcommand, or flag rules.
- Rules apply per program invocation, not per command string: chains (`&&`, `||`, `;`, `|`, `&`, newlines) are split before matching.
- The program is resolved through wrapper prefixes (`command git add`, `sudo git push`, `FOO=1 git commit`) without matching arbitrary argument positions.
- One pass yields both the decision and the highlight spans; no boolean/span twin functions.
- Shell code that executes within the same tool call is parsed wherever it appears: `$( )`, backticks, `<( )`, and `-c` payloads of known shells.
- Authors never write a tokenizer.

## Non-Goals

- Not a security boundary. Per the project ethos, this supports workflow gating; a determined bypass (`base64`-piped payloads, exotic expansions) is out of scope.
- No parsing of payloads that execute in another context (`ssh host '...'`, `docker exec ...`). Different machine, different rules.
- No exhaustive rule DSL. `matchCommand` covers the program+subcommand shape; everything else drops to `parseShellCommand` by design.

## Exposed Shape

```ts
// Foundation
function parseShellCommand(
  command: string,
  options?: { wrappers?: readonly WrapperSpec[] },
): Promise<ParsedShellCommand>;

interface ParsedShellCommand {
  commands: readonly SimpleCommand[]; // every invocation, chains and nesting flattened
  hasErrors: boolean;                 // parse gaps present (grammar ERROR nodes)
}

interface SimpleCommand {
  program: ShellToken | undefined;     // after wrapper + VAR=x skipping
  programName: string | undefined;     // basename: "/usr/bin/git" → "git"
  args: readonly ShellToken[];         // everything after program; redirects excluded
  assignments: readonly ShellToken[];  // leading VAR=x tokens
  span: HighlightSpan;                 // the whole invocation, in the original string
  hasFlag(...spellings: readonly string[]): boolean; // OR across spellings of one flag concept
  subcommand(options?: { valueFlags?: readonly string[] }): ShellToken | undefined;
  positionals(options?: { valueFlags?: readonly string[] }): readonly ShellToken[];
}

interface ShellToken extends HighlightSpan {
  text: string; // quotes decoded; start/end index the ORIGINAL command string
}

// Sugar
function matchCommand(spec: CommandSpec): (tool: BashPermissionToolInput) => Promise<PermissionDecision | undefined>;

interface CommandSpec {
  program: string | readonly string[];   // matched against programName
  subcommands?: readonly string[];       // omit to match any invocation
  valueFlags?: readonly string[];        // e.g. gitValueFlags
  subcommandPosition?: "first" | "any";  // default "first"; "any" matches any positional
  strict?: boolean;                      // default false; parse gap forces a request
  onMatch: (match: CommandMatch) => PermissionDecision | undefined; // not `then`: a then-bearing object is a thenable
}

interface CommandMatch {
  commands: readonly SimpleCommand[]; // the invocations that matched
  spans: readonly HighlightSpan[];    // program + subcommand tokens, ready for highlight
}

const gitValueFlags: readonly string[]; // -C, -c, --git-dir, --work-tree, --namespace, ...
```

`PermissionHighlight` additionally accepts `readonly HighlightSpan[]`, so precomputed spans (including `ShellToken`s, which are structurally spans) pass straight through: `highlight: hits`.

Usage, the three rules from the motivating permission module:

```ts
// git — declarative
bash: matchCommand({
  program: "git",
  subcommands: ["stash", "add", "commit", "push", "checkout", "reset", "clean", "rebase"],
  valueFlags: gitValueFlags,
  onMatch: (m) => request({ highlight: m.spans, approveLabel: "Tamper", rejectLabel: "Deny" }),
}),

// rm -rf and find -delete — foundation
bash: async ({ command }) => {
  const hits = (await parseShellCommand(command)).commands.filter(
    (c) =>
      (c.programName === "rm" &&
        c.hasFlag("-r", "-R", "--recursive") &&
        c.hasFlag("-f", "--force")) ||
      (c.programName === "find" && c.hasFlag("-delete")),
  );
  return hits.length
    ? request({ highlight: hits.map((c) => c.span), approveLabel: "Dispose", rejectLabel: "Prevent" })
    : undefined;
},

// psql — foundation, SQL sniffing stays the author's regex, but scoped to real psql invocations
bash: async ({ command }) => {
  const psql = (await parseShellCommand(command)).commands.filter((c) => c.programName === "psql");
  return psql.length && SQL_MUTATION.test(command) ? request({ ... }) : undefined;
},
```

## Design Decisions

### 1. Backend: tree-sitter-bash on web-tree-sitter

`tree-sitter-bash` (^0.25.1) is the grammar; `web-tree-sitter` (^0.26.8, artifactory floor) is the runtime that executes the grammar wasm and provides byte offsets on every node. The native `tree-sitter` N-API runtime was rejected: platform prebuilds and ABI coupling are exactly what pi's bun-distributed binary would choke on. web-tree-sitter reads the grammar `.wasm` off disk and runs on any WebAssembly engine.

The load-time risk was spiked before acceptance: a pi extension jiti-importing (with `moduleCache: false`, mirroring `loader.ts`) a TypeScript module that resolves the wasm via `createRequire(import.meta.url)` and parses a chained command passed on both pi 0.80.3 under node 24 and the bun-compiled `pi-darwin-arm64` release binary. The bun distribution ships a launcher plus on-disk `node_modules`, so resolution semantics match node.

The backend is fully hidden behind the exposed shape; no tree-sitter type appears in the public API. If the dependency sours, the internal-tokenizer fallback implements the same contract.

`Parser.init()` + `Language.load()` run once and are cached module-level; parses after warmup are synchronous internally, but the public API stays uniformly async. Parse results are memoized single-slot by command string — several hooks evaluate the same tool call back-to-back and must not parse it repeatedly.

### 2. Two layers, foundation first

A declarative DSL cannot express the long tail (flag-pair detection for `rm`, SQL sniffing for `psql`) without growing schema options forever, and it cannot exist without a parse layer underneath. So `parseShellCommand` is the contract; `matchCommand` is sugar over it for the one shape that recurs (program + subcommand set). Rules the sugar can't express drop down a layer instead of falling back to regex.

Both layers are strictly additive. The handler still receives the raw command string, and design 05's pattern and span-callback highlights remain intact — an author can bypass parsing entirely and hand-inspect the string with arbitrary logic. That escape hatch is deliberate and permanent, not legacy surface awaiting cleanup.

### 3. Program resolution skips wrappers and assignments

A simple command's program is found after skipping leading `VAR=x` assignments and a curated wrapper table — programs whose purpose is to run their argument: `command`, `exec`, `sudo`, `doas`, `env`, `nohup`, `nice`, `time`, `timeout`, `stdbuf`, `setsid`, `xargs`. Each wrapper entry declares its value-taking flags (`sudo -u root git push`) and positional skips (`timeout 5 git push`) so resolution lands on the real program. The table is overridable via `parseShellCommand` options. `programName` exposes the basename so `/usr/bin/git` matches "git" — path-qualified invocations were already handled ad hoc by the motivating psql rule.

This is one shared concept, not per-rule exceptions: the same finite, stable list every tool in this space carries.

### 4. Flag and subcommand interrogation is mechanism; program knowledge is the author's

`hasFlag(...spellings)` takes literal spellings and ORs them: one call expresses one flag concept (`hasFlag("-r", "-R", "--recursive")`), multiple concepts compose with `&&`, keeping AND/OR unambiguous. A single-dash single-character spelling matches inside bundles (`-rf`); longer spellings (`--recursive`, find-style `-delete`) match tokens exactly. Scanning stops at `--`. The bundle/exact ambiguity of single-dash flags is undecidable without program knowledge — the author, who knows their program, picks spellings accordingly.

`subcommand({ valueFlags })` returns the first non-flag argument, skipping any token that follows a listed value-taking flag (`git -C /repo add` → `add`). Which flags take values is program knowledge the library cannot own generically — the author supplies it, and the library ships `gitValueFlags` as a preset because every user of this library needs git. `positionals({ valueFlags })` exposes the same walk in full, returning every non-flag token.

When the author doesn't care to enumerate value flags, `matchCommand`'s `subcommandPosition: "any"` matches the subcommand list against every positional instead of only the first. `git -C /repo add` then matches with zero git knowledge; the price is a false positive like `git log add` (pathspec) — an extra prompt, which the workflow-gating ethos prices as acceptable. Precision and configuration burden trade off per rule, at the author's choice; `"first"` stays the default.

### 5. Nesting boundary: same-execution shell code only

Parsed: `$( )`, backticks, `<( )`/`>( )` — the grammar yields these as real command nodes, zero heuristics — plus the string payload of `bash|sh|zsh|dash -c`, which is shell code by definition. Not parsed: payloads of `ssh`, `docker exec`, and anything else that executes in another context; that road has no end, and those payloads answer to different rules. `echo $(git add .)` is caught because `git add` genuinely runs; `ssh host 'git add .'` is opaque because it genuinely doesn't run here.

### 6. Failure semantics: hooks fail open individually; parse gaps are the author's signal

A hook that throws (e.g. wasm cannot load) is caught by the evaluator, skipped, and evaluation continues with the remaining hooks; the failure surfaces as a session notification in the pattern of `notifyLoadErrors`. Previously an exception propagated into pi's runtime with an undefined outcome — internalizing a parser that *can* fail forced the decision.

Malformed or exotic input does not throw: the grammar is error-tolerant and yields a tree with `ERROR` nodes. `parseShellCommand` returns every simple command that parsed cleanly plus `hasErrors: true`. Paranoia is per-rule opt-in — an author checks `hasErrors` at the foundation layer, or sets `strict: true` on `matchCommand` to force a request on any parse gap. Default is lenient to avoid taxing every rule with prompts over harmless exotic syntax.

### 7. Highlights accept precomputed spans

`PermissionHighlight` gains `readonly HighlightSpan[]` as a variant, discriminated at runtime from the pattern-array variant by element shape. Tokens carry their offsets, so the spans produced by matching are the highlight — no closure wrapping, no second computation, and design 05's "the Author states explicitly what offended" is preserved with less ceremony.

## Edge Cases & Failure Modes

- **Quoted mentions** (`echo "git add"`): string content is not a command node; no match.
- **Argument-position collision** (`git grep add`): subcommand resolves to `grep`; no match against a mutation list.
- **Wrapped + flagged** (`command git -C /repo add`): wrapper skipped, `-C /repo` skipped via valueFlags, subcommand `add`; match.
- **Assignment prefix** (`GIT_DIR=/x git push`): assignment recorded, program `git`; match.
- **Flag bundling** (`rm -rf /`): `hasFlag("-r", "-R", "--recursive")` and `hasFlag("-f", "--force")` both true.
- **Single-dash long flags** (`find . -delete`): `hasFlag("-delete")` matches exactly; no bundle interpretation of multi-character spellings.
- **`--` terminator** (`rm -- -rf`): flag scanning stops at `--`; `-rf` is a filename; no match.
- **Loose subcommand mode** (`git log add` with `subcommandPosition: "any"`): matches — a known false positive the author opts into when skipping `valueFlags` enumeration.
- **Substitution execution** (`echo $(git add .)`): nested command surfaces as its own SimpleCommand; caught.
- **Shell payload** (`bash -c 'git add .'`): payload re-parsed; caught. `ssh host 'git add .'`: opaque; not caught.
- **Heredoc bodies**: content is not command code; inert, like quoted strings.
- **Parse gap** (unparseable fragment): clean commands still returned; `hasErrors: true`; lenient by default, `strict` requests.
- **wasm load failure**: hook throws → evaluator skips it, continues the chain, notifies; remaining hooks unaffected.
- **Pipelines** (`a | b`): each side is its own SimpleCommand; rules apply per invocation.

## Alternatives

### shell-quote

- **Status:** Rejected
- **Decision or open issue:** No source offsets (highlights impossible without re-searching), strips quotes destructively, and mangles `$( )` into `'$', {op:'('}` tokens. Verified empirically.

### sh-syntax / mvdan-sh

- **Status:** Rejected
- **Decision or open issue:** The mvdan/sh parser itself is excellent, but the WASM bridge returned a lossy AST in probing (CallExpr lost its Args), the API is Go-shaped, and maintenance of the bridge is a third-party bet. tree-sitter delivered the same offsets with a healthier ecosystem.

### Internal tokenizer (promote the hand-rolled code)

- **Status:** Rejected as primary; retained as fallback
- **Decision or open issue:** Zero dependencies and sync, but quote-nesting, substitutions, and heredocs become ours to maintain forever. Acceptable for workflow gating, but the spike removed the only reason to prefer it (wasm portability risk). If tree-sitter ever becomes unloadable in a target environment, the same public API can be backed by it.

### Declarative DSL as the only surface

- **Status:** Rejected
- **Decision or open issue:** The schema can't express flag-pair or payload-content rules without unbounded growth; the first inexpressible rule forces authors back to regex. Foundation-first inverts that failure mode.

### Fail closed on hook exceptions

- **Status:** Rejected
- **Decision or open issue:** Converting hook errors into forced requests hardens the gate but taxes every tool call while broken and gates rules the author never wrote. Chosen behavior: the failing hook alone fails open, the chain continues, and the failure is surfaced visibly.

## Implementation Plan

Phases 1–3 build the parse layer in dependency order. Phases 4 and 5 are independent of parsing and can land in any order relative to 1–3. Phase 6 depends on 1–2 (and on 1's `hasErrors` for `strict`). Phases 7–8 close the loop through release and the consuming permission module.

- [x] Phase 1: Parse foundation
  - Goal: `parseShellCommand` returns span-carrying simple commands for chained, piped, substituted, and wrapped bash input.
  - Files: `package.json` (deps), `src/shell.ts` (new), `src/index.ts` (exports), `test/shell.test.ts` (new)
  - Work: Add `web-tree-sitter` (^0.26.8) and `tree-sitter-bash` (^0.25.1) as runtime dependencies. Resolve the grammar wasm via `createRequire(import.meta.url)`; cache `Parser.init()` + `Language.load()` module-level; memoize the last parse by command string. Walk the tree into `SimpleCommand[]`: split lists/pipelines, descend into `$( )`, backticks, `<( )`; decode quoted tokens while keeping original-string offsets; resolve `program`/`programName` through leading `VAR=x` assignments and the wrapper table (per-wrapper value flags and positional skips; overridable via `options.wrappers`); exclude redirects from `args`; surface `hasErrors` from grammar ERROR nodes.
  - Validation: `mise run check`; tests cover the edge-case table above (quoted mentions inert, chain splitting, wrapper/assignment resolution, substitution extraction, parse gaps).

- [x] Phase 2: Interrogation helpers
  - Goal: Rules interrogate a `SimpleCommand` without touching tokens by hand.
  - Files: `src/shell.ts`, `src/index.ts`, `test/shell.test.ts`
  - Work: `hasFlag(...spellings)` — single-dash single-char spellings match bundles, longer spellings match exact, scanning stops at `--`. `subcommand({ valueFlags })` and `positionals({ valueFlags })` sharing the value-flag-skipping walk. Export `gitValueFlags` preset (`-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path`).
  - Validation: `mise run check`; tests for bundling, `-delete`-style exact match, `--` terminator, `git -C /repo add` → `add`.

- [x] Phase 3: Shell `-c` payload recursion
  - Goal: `bash|sh|zsh|dash -c '<payload>'` payloads parse as nested commands with spans mapped into the original string.
  - Files: `src/shell.ts`, `test/shell.test.ts`
  - Work: Detect `-c` on the shell program list; re-parse the payload token and offset nested spans by the payload's position. Only recurse when offset mapping is exact (single-quoted, or double-quoted without escapes/expansions that shift positions); otherwise leave the payload opaque rather than emit misaligned highlights.
  - Validation: `mise run check`; tests for caught `bash -c 'git add .'`, span alignment, and the conservative bail path.

- [x] Phase 4: Highlight accepts precomputed spans
  - Goal: `highlight: hits` works with a plain spans array (tokens included, structurally).
  - Files: `src/highlight.ts`, `src/index.ts`, `test/highlight.test.ts`
  - Work: Add `readonly HighlightSpan[]` to the `PermissionHighlight` union; discriminate from pattern arrays at runtime by element shape; route through existing normalization (clamp, sort, merge).
  - Validation: `mise run check`; tests for span arrays, empty arrays, mixed-shape rejection.

- [x] Phase 5: Evaluator fail-open per hook
  - Goal: A throwing hook is skipped, the chain continues, and the failure surfaces as a notification.
  - Files: `src/evaluator.ts`, `extensions/hooks.ts`, `test/evaluator.test.ts`, `test/runtime.test.ts`
  - Work: Catch per-hook exceptions in `evaluatePermissionHooks`, collect them alongside the evaluation result, keep iterating. In the `tool_call` handler, notify failures in the `notifyLoadErrors` pattern (hook name + error, warning level).
  - Validation: `mise run check`; tests: failing hook then deciding hook → decision returned + failure reported; all hooks failing → undefined + failures reported.

- [x] Phase 6: `matchCommand` sugar
  - Goal: The program+subcommand rule shape is a single declaration.
  - Files: `src/shell.ts` (or `src/match-command.ts` if `shell.ts` grows unwieldy), `src/index.ts`, `test/shell.test.ts`
  - Work: `matchCommand(spec)` returns a bash handler: parse, filter by `programName` against `program`, match `subcommands` per `subcommandPosition` (`"first"` default, `"any"` over positionals), honor `strict` (parse gap → request), invoke `onMatch` once with matched commands and program+subcommand spans; return `undefined` on no match.
  - Validation: `mise run check`; tests for both positions, strict mode, multi-program specs, and `onMatch` receiving correct spans.

- [ ] Phase 7: Docs and release
  - Goal: Authors can discover the API; a published version exists for consumers.
  - Files: `README.md`, `CHANGELOG.md`
  - Work: README authoring section for the parse and match layers with the git/rm examples from this design; CHANGELOG entry; release per `docs/release.md` (check, pack dry-run, tag `vX.Y.Z`, push).
  - Validation: `mise run check`; `npm pack --dry-run`; npm shows the new version.

- [ ] Phase 8: Migrate the consuming permission module (ansiblonomicon)
  - Goal: `chezmoi/private_dot_pi/agent/permissions/default.ts` runs on the new API; hand-rolled tokenizer deleted.
  - Files: `chezmoi/private_dot_pi/agent/permissions/default.ts`, `.../package.json`, `.../package-lock.json`
  - Work: Bump `@thurstonsand/pi-permissions` to the released version. Rewrite the git rule on `matchCommand` + `gitValueFlags`; collapse the rm/find rule pair onto `parseShellCommand` + `hasFlag`, deleting the twin boolean/span functions and the local tokenizer/segment helpers; scope the psql rule's SQL regexes to real `psql` invocations via `programName`.
  - Validation: `uv run poe lint:pi`; live smoke test per pi-permissions `DEV.md` (pi with `-e ./extensions/index.ts`, `PI_PERMISSIONS_USER_DIR` pointing at the module): `command git add` prompts with correct highlight, `git status && echo "i want to add something"` does not prompt, `git grep add` does not prompt, `echo $(git add .)` prompts, `rm -rf` prompts once with span on the invocation.
