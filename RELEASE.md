<!-- markdownlint-disable MD024 -->

# Release notes

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
