# Development

## Environment

This repo uses mise for tool versions, task execution, and local environment setup. `direnv allow` activates mise and runs the bootstrap flow so Node and npm dependencies are ready; no further action should be needed to begin development.

## Commands

```sh
mise run lint
mise run format
mise run typecheck
mise run test
mise run check
```

`mise run check` is the full verification gate.

## Smoke test

Use a separate tmux window to run Pi with the local extension entrypoint loaded directly:

```sh
tmux new-window -n pi-permissions 'cd "$(pwd)" && pi -e ./extensions/index.ts'
```

After code changes, use Pi's `/reload` command in that test session to reload the extension. Keep this as a live manual smoke test for extension startup, command registration, prompt behavior, and tool-call interception.

## Code style

- Comments, outside those standardized in the language, should only ever be added to explain non-obvious decisions or surprising behavior
- Prefer top-down code organization:
  - exported entry points and primary behavior first
  - helpers after first use where practical
  - exported API types near the top
