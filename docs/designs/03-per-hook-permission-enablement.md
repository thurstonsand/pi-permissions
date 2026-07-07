# Per-hook permission enablement

## Status

Draft

## Decision Summary

`pi-permissions` will track enablement per permission hook instead of treating permission checks as a separate global master switch. The existing global `/permissions enable`, `/permissions disable`, and shortcut behavior become shorthand for enabling or disabling all currently loaded hooks, while the modal and targeted slash commands let the Approver manage individual hooks. The tradeoff is a slightly richer persisted state model in exchange for precise workflow control and a more truthful UI.

## Problem Statement / Background

The current `/permissions` modal shows loaded permission hooks and a single enabled/disabled status. That is useful when the Approver wants all permission gates active or inactive, but it is too coarse when one hook is noisy and another remains important.

Concrete scenario: an Approver may want to disable a project-specific deployment prompt during a maintenance session while keeping a user-level `Git interference` hook active to protect their review workflow. The current model forces the Approver to choose between all prompts or none.

The modal also currently renders a static list. As package-level and project-level permissions grow, the list can exceed the available terminal area. The UI needs to support scrolling and keyboard-driven toggling without persisting accidental intermediate changes.

## Goals

- Let the Approver enable or disable individual permission hooks in the current session branch.
- Keep newly seen hooks enabled by default.
- Preserve branch-local persistence through Pi custom session entries.
- Keep existing global command and shortcut affordances as shorthand over currently loaded hooks.
- Make `/permissions` interactive for long hook lists with keyboard navigation, scroll, draft changes, save, and cancel.
- Provide targeted slash-command shortcuts for exact permission-hook names.
- Update README documentation and screenshots for the new management UI.

## Non-Goals

- Do not add a public Author API for declaring default disabled hooks.
- Do not persist enablement outside the current session branch.
- Do not add fuzzy matching for targeted slash-command hook names.
- Do not change package permission filters; those remain install/load-time selection rather than runtime enablement.

## Exposed Shape

The Approver interacts with permission enablement through three surfaces:

```text
/permissions
/permissions enable
/permissions disable
/permissions enable <permission name>
/permissions disable <permission name>
```

The untargeted `enable` and `disable` forms apply to all currently loaded permission hooks. The targeted forms apply to exactly one hook by name after an exact, case-insensitive unique-name lookup.

The `/permissions` modal is a master–detail view. The left pane lists loaded hooks — enabled/disabled dot and hook name — grouped under origin section labels (`project`, `user`, then each package) and scrolls when the list exceeds the visible window. The right pane is a static detail card for the selected hook: name, `source · module path` on one line, then the description. Keyboard behavior:

- `j`/`k` and arrow keys navigate the list.
- `space` toggles the selected hook in the draft state.
- `g` toggles all currently loaded hooks in the draft state: if any are enabled, disable all; if none are enabled, enable all.
- `enter` saves the draft state and closes the modal.
- `esc` closes the modal without saving.

The footer status displays the active count over the loaded count, for example `permissions:3/5`. This includes all-on and all-off states as `permissions:5/5` and `permissions:0/5`.

## Design Decisions

### 1. Permission hooks are the enablement unit

Enablement applies to each registered `Permission hook`, not each module, source, or package. This matches what the Approver sees in the modal and what Authors name through `api.onToolUse({ name })`.

The cost is that one module registering multiple hooks produces multiple persisted enablement targets. That is the correct granularity because those hooks may protect different workflows.

### 2. Global enablement becomes shorthand, not a master switch

The current global boolean is replaced by per-hook enablement state. Untargeted global commands and the existing toggle shortcut mutate the currently loaded hook set instead of setting a separate master switch.

For a toggle operation, the rule is:

- if any currently loaded hooks are enabled, disable all currently loaded hooks
- if zero currently loaded hooks are enabled, enable all currently loaded hooks

This makes mixed state predictable: `3/5` toggles to `0/5`, not `2/5`. An inversion toggle would be technically literal and practically useless.

### 3. Newly seen hooks default enabled

A hook with no persisted enablement entry is enabled. This keeps newly authored or newly loaded permission hooks active by default after reloads, even if previous runtime state only mentioned older hooks.

The tradeoff is that `/permissions disable` only disables hooks that are loaded at the time it runs. A hook added later appears enabled until the Approver disables it. That matches the resolved meaning that there is no global master switch.

### 4. Hook identity is stable enough, not name-only

Persisted enablement needs a hook key that distinguishes duplicate names in the modal. The key should be derived from stable loaded-hook metadata rather than the display name alone, using source, module path, hook name, and an ordinal for duplicate registrations within the same module/name group.

This means renaming a hook or moving its module resets it to the default enabled state. That is acceptable because the hook has effectively changed from the Approver's perspective.

### 5. Targeted slash commands require unique exact names

`/permissions enable <permission name>` and `/permissions disable <permission name>` perform exact, case-insensitive name lookup. If no hook matches, the command reports that no permission was found. If multiple loaded hooks share that name, the command refuses and points the Approver to the modal.

This avoids guessing. Runtime permission changes are workflow controls; fuzzy matching is the wrong kind of helpful.

### 6. The modal is transactional

The modal edits a draft copy of enablement. `space` and `g` update only the draft. `enter` persists the draft and closes; `esc` closes without saving.

This protects the Approver from accidental keyboard changes while browsing a long list. It also gives the modal a clear commit boundary, matching the user's review-oriented workflow.

### 7. The modal is a master–detail view with origin sections

The modal splits into a scrolling list pane and a static detail pane. The left pane owns state: one line per hook with an enabled/disabled dot, grouped under color-coded origin labels. The right pane shows the selected hook's name, `source · module path`, and description, and never repeats enablement state.

A single flat list with an expanding selected row was rejected: expanding the selection reflows every row below it, so cursor movement shifts the list the Approver is trying to read. With the detail pane, toggling changes exactly one character on screen (the dot) and moving the cursor changes only the cursor and the card.

The origin sections cost no ordering: hook loading already concatenates project, user, then package hooks, so each origin is contiguous in evaluation order. The labels only make existing boundaries visible, and top-to-bottom continues to read as first-terminal-decision-wins order.

### 8. The list pane owns long-list navigation

The list pane renders a bounded visible window over all left-pane lines. Selection movement adjusts the scroll offset so the selected hook remains visible. A proportional scroll rail marks position beside the list, and the footer legend shows the visible range (for example `5–12 of 14`).

This avoids relying on terminal scrollback for an interactive control. Permission state changes need visible locality: the selected row, its current state, and nearby hooks should stay on screen.

### 9. Evaluation filters disabled hooks before matching

Disabled hooks do not participate in matcher evaluation. The evaluator should only inspect enabled hooks, preserving the existing first-terminal-decision behavior among the active subset.

Filtering before matching prevents disabled hooks from running arbitrary matcher or handler code. That is more complete than ignoring only terminal decisions.

## Edge Cases & Failure Modes

- **No hooks are loaded:** The modal shows an empty state; global enable/disable persists no hook-specific changes and reports that there are no permissions to manage.
- **Duplicate hook names:** Targeted slash commands refuse to choose; the modal shows each hook separately with source/module context.
- **Hook renamed or moved:** The old persisted key no longer matches; the hook defaults enabled.
- **Hook removed:** Its persisted key may remain in older session entries but has no effect.
- **Session branch navigation:** Restore enablement from the current branch's latest permissions state entry.
- **Legacy state entry with `{ enabled: false }`:** Restore as all currently loaded hooks disabled for backward compatibility.
- **Legacy state entry with `{ enabled: true }` or no state entry:** Restore as hooks enabled by default.
- **Mixed state global toggle:** Toggle to all disabled when at least one hook is enabled; toggle to all enabled only when none are enabled.
- **Non-TUI or no UI:** `/permissions` falls back to a plain summary; targeted and global slash commands still operate through notifications.

## Alternatives

### Keep a separate global master switch plus per-hook disables

- **Status:** Rejected
- **Decision:** Global enablement should be shorthand over hook enablement, not an additional gate.
- **Retained discussion:** A separate master switch is mechanically close to the current implementation, but it creates confusing states where a hook appears enabled while global state prevents it from running.

### Store only disabled hook names

- **Status:** Rejected
- **Decision:** Persist hook keys, not names alone.
- **Retained discussion:** Names are human-facing and can collide across project, user, and package permissions. The targeted command may use names for convenience, but storage should distinguish duplicate hooks.

### Fuzzy match targeted permission names

- **Status:** Rejected
- **Decision:** Targeted slash commands require exact, case-insensitive unique names.
- **Retained discussion:** Fuzzy matching would reduce typing but risks changing the wrong permission. Autocomplete can solve typing without guessing.

### Toggle mixed state by inverting each hook

- **Status:** Rejected
- **Decision:** Mixed global toggle disables all currently loaded hooks.
- **Retained discussion:** Inversion makes `3/5` become `2/5`, which is surprising and not useful for the global toggle's intended meaning: quickly suspend or restore permission checks.
