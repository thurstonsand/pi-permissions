import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import type { PermissionEnablement, RuntimePermissionHook } from "./enablement.js";

const PERMISSIONS_STATE_SCHEMA = Type.Object({
  enabled: Type.Optional(Type.Boolean()),
  hooks: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
});

type PermissionsState = Static<typeof PERMISSIONS_STATE_SCHEMA>;

const STATE_TYPE = "permissions";

export function persistPermissionsState(pi: ExtensionAPI, enablement: PermissionEnablement): void {
  pi.appendEntry<PermissionsState>(STATE_TYPE, { hooks: enablement });
}

export function restorePermissionsState(
  ctx: ExtensionContext,
  hooks: readonly RuntimePermissionHook[],
): PermissionEnablement {
  const last = ctx.sessionManager
    .getBranch()
    .findLast((entry) => entry.type === "custom" && entry.customType === STATE_TYPE);

  if (last?.type !== "custom") return {};
  if (!Value.Check(PERMISSIONS_STATE_SCHEMA, last.data)) return {};

  const data = last.data;
  if (data.hooks) return data.hooks;
  if (data.enabled === false) return Object.fromEntries(hooks.map((hook) => [hook.id, false]));
  return {};
}
