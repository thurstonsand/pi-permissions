# Durable permission state entries

## Status

Accepted

Builds on design 03 (per-hook permission enablement). Terminology per `CONTEXT.md`: Approver, Permission hook, Enabled, and Permission state entry.

## Decision Summary
Effective permission enablement transitions become durable, branch-local transcript cards by rendering the custom entries already used for restoration. New entries replace the internal enablement record with one complete hook snapshot that serves both restoration and stable historical rendering; the tradeoff is a clean persisted-schema break that discards old permission state.


## Problem Statement / Background

Permission enablement already persists through custom session entries:

```ts
pi.appendEntry("permissions", { hooks: enablement });
```

Restoration reads the latest matching entry on the active branch. These entries are invisible, so an Approver returning to a session can see the current `permissions:3/5` footer status but cannot see when permission behavior changed or which hooks produced that state.

Pi now lets extensions pair `appendEntry()` with `registerEntryRenderer()`. This can expose the existing branch-local state transitions without creating model-visible messages or a second persistence mechanism.

The current persistence boundary is too loose to render directly: every modal save and successful enable/disable command appends a snapshot, even when effective state did not change. Rendering those records would turn no-op interactions into false historical events. Existing entries also contain only internal hook IDs and booleans. They cannot reconstruct the loaded-hook total, the prior state, or stable human-facing labels after modules move, disappear, or change.

Concrete scenario: an Approver disables one noisy project hook while retaining five other checks, continues working, then later branches the session and re-enables it. The transcript should show two state transitions at their branch-local positions. It should not show cards for opening and saving the modal without edits, and an older session should not suddenly gain speculative cards derived from opaque IDs.

## Goals

- Make effective permission enablement transitions visible at their durable, branch-local transcript positions.
- Use one persisted hook snapshot as the source for both restoration and presentation.
- Preserve stable historical labels and resulting state even when the current permission modules differ.
- Avoid duplicate TUI feedback and avoid new output in modes that cannot render custom entries.
- Keep permission decisions, tool details, descriptions, and filesystem paths out of this history.
- Prove transition detection, strict schema rejection, removed-hook behavior, rendering, mode behavior, reload, and branch navigation.

## Non-Goals

- Audit individual Approve, Reject, Edit, block, or request outcomes.
- Persist runtime failures, module load errors, usage errors, or other transient feedback.
- Show the control that caused a transition, such as the modal, slash command, or shortcut.
- Render old state-only entries, whether generically or by decoding internal permission hook IDs.
- Change the footer status, permission summary modal, evaluation order, or enablement defaults.
- Add textual transition output to JSON or print modes.

## Exposed Shape

### Approver-facing transcript card

Each effective transition renders as a custom-message-style card using Pi's `customMessageBg`. The compact line uses aggregate wording for every transition, including a one-hook change:

```text
Permissions · 1 check disabled · 5/6 active
Permissions · 3 checks enabled · 6/6 active
Permissions · 2 checks changed · 4/6 active
```

A uniform transition says `enabled` or `disabled`. A transition containing both directions says `changed`. `check` is singular only for one change.

When transcript details are expanded, the card shows the complete resulting hook inventory in its persisted runtime order. Each row contains:

- an enabled or disabled status dot;
- the hook name;
- its user, project, or package source;
- a leading `*` when that row participated in the transition, or two spaces when it did not.

For example:

```text
Permissions · 2 checks changed · 4/6 active

  ○ Git mutations             user
  ● Destructive removal       user
* ● Production deployment     project
  ● Generated files           project
* ○ Release publication       package:release-guard
  ● Secrets                   package:read-guard
```

Theme colors carry status without replacing the text contract: the title uses an accent, enabled dots use success, disabled dots use warning, and source/count metadata is muted. The leading `*` makes changed rows scannable without reordering them or adding a trailing column.

The card does not render descriptions, module paths, permission roots, tool details, decisions, or control provenance.

### Persisted entry contract

The custom type remains `permissions`. New entries replace the old `hooks` record with one complete hook array that serves restoration and rendering:

```ts
interface PersistedPermissionHook {
  id: string;
  name: string;
  source: PermissionSource;
  enabled: boolean;
  changed: boolean;
}

interface PermissionsStateEntry {
  hooks: PersistedPermissionHook[];
}
```

The hook array is a complete after-state snapshot, not a diff. Active count, total count, transition direction, and changed count are derived from it. Restoration reduces the same array to its `id` and `enabled` fields; rendering reads its human-facing fields directly. There is no separate version or presentation object because both would duplicate information already expressed by the array's shape.

This is a clean persisted-schema break. Restoration and rendering accept only the complete hook-array shape. Old `{ hooks: Record<string, boolean> }` entries, legacy `{ enabled: false }` entries, and malformed new entries are treated exactly like no permission state entry: restoration returns default enablement and the renderer returns no component. No legacy parsing or partial recovery remains.

A stale persisted hook ID in a valid new snapshot has no runtime effect when that hook is no longer loaded. A currently loaded hook absent from the snapshot retains the design 03 default of enabled.

### Transition commit contract

A commit receives the currently loaded hooks plus before and after enablement snapshots. It compares each loaded hook's effective state, marks changed rows, and persists only the complete after-state hook array. The before snapshot is commit-time input, not duplicated in the JSONL entry.

It appends a permission state entry only when at least one loaded hook changes. The commit boundary reports enough information to its caller to distinguish a transition from a no-op. Callers then own interaction-specific feedback:

- modal save with no changes closes silently;
- named or global no-op commands notify `Permissions unchanged`;
- no-hooks-loaded retains its existing informational notification;
- Alt+P changes state whenever hooks are loaded, so it produces a transition.

Changes to raw map entries that do not affect currently loaded hooks are not permission state transitions.

### Pi mode boundary

`appendEntry()` remains mode-independent so branch restoration is consistent. Rendering and immediate feedback differ by Pi mode:

| Mode | Durable entry | Transcript card | Successful transition notification |
| --- | --- | --- | --- |
| TUI | Appended | Rendered | Suppressed to avoid duplicate feedback |
| RPC | Appended | Unavailable | Retained through `ctx.ui.notify()` |
| JSON | Appended if a transition is invoked | Unavailable | None |
| Print | Appended if a transition is invoked | Unavailable | None |

Transient warnings and errors keep their existing notification behavior. Registering the renderer is harmless outside TUI mode; Pi simply does not use it there.

## Design Decisions

### 1. Durable history records effective transitions, not successful interactions

A Permission state entry asserts that session behavior changed. Saving an unchanged modal or repeating an already-satisfied command does not satisfy that contract and does not append an entry.

This deliberately tightens the current persistence behavior. Repeating the same snapshot adds no restoration value because the preceding branch entry already represents the effective state. Avoiding no-op persistence also prevents transcript noise from masquerading as history.

### 2. Enablement is the only durable permission event in scope

Individual prompt outcomes and runtime failures remain outside permission state history. Approvals, rejections, edited commands, and tool details have different privacy, retention, and noise characteristics; adding them would turn a state renderer into an audit-log design.

Command usage errors, unknown or ambiguous names, no-hooks-loaded, load failures, cancellation, and similar conditions remain transient notifications.

### 3. One hook snapshot owns restoration and presentation

New entries use one complete `hooks` array rather than an enablement record plus a presentation copy. Each row carries the stable ID and boolean needed for restoration alongside the name, source, and changed flag needed for rendering.

This makes the array shape itself the only schema boundary. Malformed and legacy entries fail closed without throwing, restoration, partial recovery, or rendering.

### 4. New entries snapshot every loaded hook

The renderer receives an individual custom entry, not current runtime hooks or neighboring state entries. It cannot truthfully reconstruct historical names, totals, ordering, or changes from the old `hooks` record alone.

Each new entry therefore persists every loaded hook's ID, name, source, resulting enabled state, and changed marker in runtime order. This is more data than the old boolean record but does not duplicate the same information across separate state and presentation structures. The complete snapshot leaves room to simplify future rendering without migrating old entries.

### 5. Historical identity is name plus source, never path

Expanded rows show the Author-facing hook name and its source. Name alone cannot disambiguate identical hooks across user, project, and package scopes. Module paths and permission roots would disambiguate further, but expose local filesystem and package layout without helping the Approver understand the state transition.

Descriptions are also excluded. They belong in the interactive permission summary and prompt, not repeated in every historical card.

### 6. Legacy entries are discarded

Old `{ hooks: Record<string, boolean> }` and `{ enabled: false }` entries neither restore nor render. They are tolerated only in the sense that validation fails without throwing and permission enablement falls back to its normal defaults.

This intentionally resets old branch-local permission state after upgrade. Backward compatibility is not worth retaining a second persisted schema for a single-user plugin. Internal hook IDs are not decoded, and no generic `Permissions changed` card is shown.

### 7. Compact cards describe aggregate change uniformly

A one-hook transition uses the same count-oriented grammar as a batch: `1 check disabled`, not the hook's name. Uniform wording keeps card width and scanning behavior predictable. Hook names belong to expanded mode.

Uniform-direction transitions say `enabled` or `disabled`; mixed-direction modal saves say `changed`. Every compact line includes the resulting active/total count.

### 8. Expanded cards show complete state and mark changes first

Expanded mode renders the complete persisted inventory rather than only the diff. Changed rows retain their runtime/source position and begin with `*`; unchanged rows reserve the same width with two spaces.

A leading marker is visible before the eye commits to reading the row and avoids a ragged trailing `changed` column. Moving changed rows to the top would make the immediate diff easier to scan but would destroy the evaluation-oriented ordering shown elsewhere in the permission UI. The marker is `*`, not `>` or `›`, because those symbols already imply selection or navigation in the permission summary.

### 9. The card replaces successful TUI transition notifications

In TUI mode, a durable card and transient success toast would report the same event twice. The card becomes the successful transition confirmation. RPC mode retains notifications because entry renderers are TUI-only and `ctx.ui.notify()` is its immediate extension feedback channel.

No-op commands still notify explicitly because no card appears. No-op modal saves close silently because the Approver was already looking at the unchanged state.

### 10. History records behavior, not control provenance

Entries do not say whether a transition came from `/permissions`, the modal, or Alt+P. The durable fact is which permission hooks changed and the resulting state. Persisting control provenance would couple the schema to current UI affordances without helping restoration or interpretation.

## Edge Cases & Failure Modes

- **Modal saves without edits:** Close silently; do not mutate runtime state or append an entry.
- **Named/global command is already satisfied:** Do not append; notify `Permissions unchanged` in UI-capable modes.
- **No hooks are loaded:** Preserve the existing `No permission hooks loaded` notification; do not append.
- **Mixed modal transition:** Compact text says `N checks changed`; expanded rows identify both enabled and disabled changes in place.
- **One hook changes:** Compact text still says `1 check enabled` or `1 check disabled`; it does not inline the hook name.
- **Duplicate hook names:** Expanded source labels disambiguate different scopes. Exact duplicates within one source may remain visually identical, matching the chosen sensitivity boundary.
- **Hook is renamed, moved, removed, or reordered later:** Existing cards retain the persisted historical snapshot. A stale ID is ignored because evaluation only consults currently loaded hooks.
- **A disabled hook is removed and another hook remains or appears:** The removed hook has no runtime effect. Any persisted state for still-loaded hooks is restored, while a current hook absent from the snapshot defaults enabled. This requires a direct regression test.
- **A new hook appears later:** It defaults enabled under design 03 and appears only in snapshots created while it is loaded.
- **Old `{ hooks: Record<string, boolean> }` entry:** Treat as no state entry; restore defaults and render nothing.
- **Legacy `{ enabled: false }` entry:** Treat as no state entry; restore defaults and render nothing.
- **New hook-array entry is malformed:** Treat as no state entry; do not throw, restore partial guesses, or render content.
- **Entire latest state entry is invalid:** Restore defaults; do not invent state or render content.
- **Renderer throws unexpectedly:** Pi's renderer boundary displays its standard renderer-failure component; pure validation should make malformed persisted data return no component instead.
- **Branch navigation, fork, or reload:** Restoration reads the active branch's latest state entry; transcript cards appear only on the selected branch at their persisted positions.
- **Historical card shows disabled hooks that were later enabled:** The card remains a point-in-time record, not a current warning. Current state continues to live in the footer and latest branch entry.

## Alternatives

### Render every existing state snapshot

- **Status:** Rejected
- **Decision:** Only effective transitions create renderable entries.
- **Discussion:** This would preserve append behavior, but no-op modal saves and idempotent commands would become visible events despite changing nothing.

### Persist every commit but mark only transitions renderable

- **Status:** Rejected
- **Decision:** No-op snapshots add no restoration value and should not be persisted.
- **Discussion:** A separate visibility marker would preserve historical implementation behavior at the cost of unnecessary schema and transcript records.

### Snapshot only changed hooks

- **Status:** Rejected
- **Decision:** Persist the complete hook inventory.
- **Discussion:** A diff-only payload is smaller and sufficient for the first renderer, but cannot support the agreed complete expanded state or a future presentation change without consulting unstable current configuration.

### Store a hook record plus separate presentation metadata

- **Status:** Rejected
- **Decision:** One complete hook array serves restoration and rendering.
- **Discussion:** A `Record<id, enabled>` alongside `presentation.hooks` duplicates hook identity and state, creates two authorities that can disagree, and adds versioning only to distinguish a shape already distinguishable at runtime.

### Persist complete before and after snapshots

- **Status:** Rejected
- **Decision:** Before and after enablement exist only at commit time; entries persist the complete after-state with per-row changed flags.
- **Discussion:** Persisting both snapshots roughly doubles each entry. The renderer needs the resulting state and diff, both of which the after snapshot plus changed flags already provides.

### Derive labels from current runtime hooks

- **Status:** Rejected
- **Decision:** Historical labels are persisted at transition time.
- **Discussion:** The entry renderer has no runtime context, and even if it did, current configuration would make old history drift after renames, removals, or reordering.

### Retain restoration compatibility for old entries

- **Status:** Rejected
- **Decision:** Accept only the new complete hook-array shape.
- **Discussion:** Supporting old record-shaped and global-boolean entries is mechanically possible, but keeps multiple persisted schemas and parsing branches for state owned by a single user. Resetting old branch state to defaults once is preferable to carrying that complexity.

### Decode labels from internal hook IDs

- **Status:** Rejected
- **Decision:** Old entries are discarded.
- **Discussion:** IDs encode implementation details including module paths, cannot recover the prior state needed to identify a transition, and would expose data intentionally omitted from cards.

### Show only the resulting active count

- **Status:** Rejected
- **Decision:** Compact cards include aggregate transition direction and count.
- **Discussion:** `Permissions · 4/6 active` is quiet but forces expansion to learn whether the event enabled, disabled, or mixed hooks.

### Render changed hooks only when expanded

- **Status:** Rejected for the initial renderer
- **Decision:** Expanded mode shows the complete resulting inventory and marks changes in place.
- **Discussion:** The complete persisted snapshot intentionally keeps a changed-only renderer available as a future simplification if full cards prove too large.

### Use a quiet unboxed event row

- **Status:** Rejected
- **Decision:** Use a custom-message-style background card.
- **Discussion:** An unboxed row consumes less space, but enablement transitions deserve a distinct durable boundary in the transcript. Compact mode limits the normal footprint.

### Keep successful transition notifications in TUI

- **Status:** Rejected
- **Decision:** The durable card replaces the transient TUI success notification.
- **Discussion:** Showing both duplicates the same feedback. RPC keeps notifications because it cannot render the card.

### Emit transition output in JSON and print modes

- **Status:** Rejected
- **Decision:** Add no new non-UI output channel.
- **Discussion:** Custom entry rendering is a TUI feature. Inventing separate event or stdout semantics would broaden the design beyond durable transcript presentation.

## Implementation Plan

- [x] Phase 1: Replace persisted enablement state
  - Goal: Make one strict hook-array snapshot own restoration and transition detection.
  - Files: `src/state.ts`, `extensions/shared/toggle.ts`, `extensions/hooks.ts`, state and toggle tests.
  - Work: Remove legacy parsing, construct snapshots from commit-time before/after state, skip no-op persistence, and prove stale IDs do not affect loaded hooks.
  - Validation: Typecheck and focused unit tests.

- [x] Phase 2: Render durable permission transitions
  - Goal: Register compact and expanded transcript cards for valid permission state entries.
  - Files: `extensions/index.ts`, `src/ui/permissions-entry.ts`, renderer tests.
  - Work: Add strict entry validation, aggregate compact wording, complete expanded inventory, and leading `*` markers.
  - Validation: Compact, expanded, mixed, legacy-hidden, malformed-hidden, and no-op-hidden render tests.

- [x] Phase 3: Align feedback and documentation
  - Goal: Avoid duplicate TUI success feedback while preserving RPC and no-op command notifications.
  - Files: `extensions/command.ts`, `extensions/shared/toggle.ts`, `README.md`, mode behavior tests.
  - Work: Suppress transition notifications in TUI, retain them in RPC, notify explicit command no-ops, and document branch-local cards.
  - Validation: `mise run check` and manual TUI smoke test.
