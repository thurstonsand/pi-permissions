<!-- markdownlint-disable MD024 -->

# Release notes

## 0.1.2

Initial release of `@thurstonsand/pi-permissions`.

### Added

- Added permission hook loading for user-level modules and trusted project-level modules.
- Added the public permission hook API, matcher helpers, and typed tool input helpers.
- Added interactive request prompts, pending approval state, and a permissions summary UI.
- Added `/permissions` for viewing loaded hooks and toggling checks per session branch.
- Added configurable toggle shortcut support via `permissions.toggleShortcut` (`alt+p` by default).
