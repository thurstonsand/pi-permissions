# TODO

## Features

- **`powershell` tool support**. Pi 0.84.3 added an optional `powershell` built-in
  alongside `bash`, selectable through `defaultTools` and the SDK, with its own
  `PowerShellToolCallEvent`, `PowerShellToolInput`, and `isPowerShellToolResult`
  exports. `permissionToolInputFromToolCall()` in `src/tool-input.ts` has no case
  for it, so a PowerShell call falls through to `CustomPermissionToolInput` with a
  stringified `detail` and no `command` field. It is still gated, which is the
  right failure direction, but shell rules cannot see the command and
  `isBashToolInput()` will not match it. Add a `PowerShellPermissionToolInput`
  variant carrying `command`, and decide whether shell rules should match both
  shells through one predicate or stay separate — PowerShell command syntax does
  not parse under `src/shell.ts`, which assumes POSIX. Windows-only for now, so
  there is no urgency.
