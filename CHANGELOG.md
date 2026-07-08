<!-- markdownlint-disable MD024 -->

# Release notes

## 0.7.0

Adds predicate-based command matching for bash permission rules.

### Added

- Added `where` to `matchCommand()`'s `CommandSpec` — an arbitrary `(command) => boolean` predicate that narrows matches alongside `subcommands`.

## 0.6.0

Adds structural shell command parsing for bash permission rules.

### Added

- Added `parseShellCommand()`, `matchCommand()`, and `gitValueFlags` for bash command parsing and program/subcommand matching.
- Added precomputed highlight span arrays as a `request({ highlight })` option.

### Changed

- Permission hook evaluation now skips a throwing hook, continues evaluating later hooks, and reports the failure as a warning notification.
- Added `tree-sitter-bash` and `web-tree-sitter` as dependencies for shell command parsing.

## 0.5.0

Simplifies permission hook authoring and adds request prompt highlights.

### Breaking

- Removed the `matcher` field from permission hooks. Handlers should return `undefined` when a tool call is not relevant.

### Added

- Added request prompt highlights through `highlight` on `request()` prompts.
- Added `highlightSpans()` for resolving literal, RegExp, and callback-based highlight spans.

### Changed

- Updated README examples to use handler-based filtering and highlight offending command fragments.

## 0.4.0

Tracks permission enablement per hook instead of a single global switch.

### Added

- Added per-hook enablement: enable or disable individual permission hooks for the current session branch.
- Added an interactive `/permissions` modal with keyboard navigation, scrolling, draft edits, and save/cancel.
- Added targeted `/permissions enable <name>` and `/permissions disable <name>` for a single hook by exact, case-insensitive name.

### Changed

- `/permissions enable`, `/permissions disable`, and the `Alt+P` shortcut now apply to all currently loaded hooks, and the footer shows the active/loaded count (for example `permissions:3/5`).
- Agent-facing approval, block, and rejection messages now name the permission hook consistently.

## 0.3.0

Adds package-level permission hooks.

### Added

- Added package-bundled permissions through Pi package `pi.permissions` metadata and top-level `permissions/` convention directories.
- Added package permission filtering with Pi-style include, exclude, force-include, force-exclude, and empty-array disable semantics.
- Added `PermissionSource` metadata on registered hooks and load errors.

### Changed

- Added `minimatch` as a runtime dependency for package permission filter matching.

## 0.2.0

Simplifies the permission decision model and adds small authoring helpers.

### Breaking

- Authors returning `{ decision: "pass" }` should return `undefined` instead.

### Added

- Added `request()` and `block()` helpers for terminal permission decisions.
- Added `isCustomToolInput()` for narrowing custom tools by name.

### Changed

- Removed the explicit `pass` decision. Permission hooks now return `undefined` when they do not make a terminal decision.
- Custom tool inputs now expose record-shaped input data.

## 0.1.4

Initial release of `@thurstonsand/pi-permissions`.

### Added

- Added permission hook loading for user-level modules and trusted project-level modules.
- Added the public permission hook API, matcher helpers, and typed tool input helpers.
- Added interactive request prompts, pending approval state, and a permissions summary UI.
- Added `/permissions` for viewing loaded hooks and toggling checks per session branch.
- Added configurable toggle shortcut support via `permissions.toggleShortcut` (`alt+p` by default).
