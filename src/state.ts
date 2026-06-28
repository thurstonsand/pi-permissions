import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type PermissionsState = { enabled: boolean };

const STATE_TYPE = "permissions";

export function persistPermissionsState(pi: ExtensionAPI, enabled: boolean): void {
  pi.appendEntry<PermissionsState>(STATE_TYPE, { enabled });
}

export function restorePermissionsState(ctx: ExtensionContext): boolean {
  const last = ctx.sessionManager
    .getBranch()
    .findLast((entry) => entry.type === "custom" && entry.customType === STATE_TYPE);

  if (last?.type !== "custom") return true;
  return (last.data as PermissionsState).enabled ?? true;
}
