import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import {
  isPermissionHookEnabled,
  type PermissionEnablement,
  type RuntimePermissionHook,
} from "./enablement.js";

const PERMISSION_SOURCE_SCHEMA = Type.Union([
  Type.Literal("project"),
  Type.Literal("user"),
  Type.TemplateLiteral([Type.Literal("package:"), Type.String()]),
]);

const PERSISTED_PERMISSION_HOOK_SCHEMA = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    source: PERMISSION_SOURCE_SCHEMA,
    enabled: Type.Boolean(),
    changed: Type.Boolean(),
  },
  { additionalProperties: false },
);

const PERMISSIONS_STATE_SCHEMA = Type.Object(
  { hooks: Type.Array(PERSISTED_PERMISSION_HOOK_SCHEMA) },
  { additionalProperties: false },
);

export type PersistedPermissionHook = Static<typeof PERSISTED_PERMISSION_HOOK_SCHEMA>;
export type PermissionsState = Static<typeof PERMISSIONS_STATE_SCHEMA>;

export const PERMISSIONS_STATE_TYPE = "permissions";

export function createPermissionsState(
  hooks: readonly RuntimePermissionHook[],
  before: PermissionEnablement,
  after: PermissionEnablement,
): PermissionsState | undefined {
  const snapshot = hooks.map((hook) => {
    const enabled = isPermissionHookEnabled(after, hook);
    return {
      id: hook.id,
      name: hook.name,
      source: hook.source,
      enabled,
      changed: enabled !== isPermissionHookEnabled(before, hook),
    };
  });

  return snapshot.some((hook) => hook.changed) ? { hooks: snapshot } : undefined;
}

export function persistPermissionsState(pi: ExtensionAPI, state: PermissionsState): void {
  pi.appendEntry<PermissionsState>(PERMISSIONS_STATE_TYPE, state);
}

export function parsePermissionsState(data: unknown): PermissionsState | undefined {
  return Value.Check(PERMISSIONS_STATE_SCHEMA, data) ? data : undefined;
}

export function restorePermissionsState(ctx: ExtensionContext): PermissionEnablement {
  const last = ctx.sessionManager
    .getBranch()
    .findLast((entry) => entry.type === "custom" && entry.customType === PERMISSIONS_STATE_TYPE);

  if (last?.type !== "custom") return {};
  const state = parsePermissionsState(last.data);
  if (!state) return {};

  return Object.fromEntries(state.hooks.map((hook) => [hook.id, hook.enabled]));
}
