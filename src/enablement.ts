import type { RegisteredPermissionHook } from "./api.js";

export interface RuntimePermissionHook extends RegisteredPermissionHook {
  id: string;
}

export type PermissionEnablement = Record<string, boolean>;

export interface PermissionEnablementStatus {
  active: number;
  total: number;
}

export function formatActiveCount(status: PermissionEnablementStatus): string {
  return `Permission checks active: ${status.active}/${status.total}`;
}

export function assignPermissionHookIds(
  hooks: readonly RegisteredPermissionHook[],
): RuntimePermissionHook[] {
  const seen = new Map<string, number>();

  return hooks.map((hook) => {
    const baseKey = getPermissionHookBaseKey(hook);
    const ordinal = seen.get(baseKey) ?? 0;
    seen.set(baseKey, ordinal + 1);

    return {
      ...hook,
      id: `${baseKey}#${ordinal}`,
    };
  });
}

export function isPermissionHookEnabled(
  enablement: PermissionEnablement,
  hook: RuntimePermissionHook,
): boolean {
  return enablement[hook.id] ?? true;
}

export function getEnabledPermissionHooks(
  hooks: readonly RuntimePermissionHook[],
  enablement: PermissionEnablement,
): RuntimePermissionHook[] {
  return hooks.filter((hook) => isPermissionHookEnabled(enablement, hook));
}

export function getPermissionEnablementStatus(
  hooks: readonly RuntimePermissionHook[],
  enablement: PermissionEnablement,
): PermissionEnablementStatus {
  return {
    active: hooks.filter((hook) => isPermissionHookEnabled(enablement, hook)).length,
    total: hooks.length,
  };
}

export function setAllPermissionHooks(
  enablement: PermissionEnablement,
  hooks: readonly RuntimePermissionHook[],
  enabled: boolean,
): PermissionEnablement {
  const next = { ...enablement };
  for (const hook of hooks) {
    next[hook.id] = enabled;
  }
  return next;
}

export function toggleAllPermissionHooks(
  enablement: PermissionEnablement,
  hooks: readonly RuntimePermissionHook[],
): PermissionEnablement {
  const anyEnabled = hooks.some((hook) => isPermissionHookEnabled(enablement, hook));
  return setAllPermissionHooks(enablement, hooks, !anyEnabled);
}

export function setPermissionHookEnabled(
  enablement: PermissionEnablement,
  hook: RuntimePermissionHook,
  enabled: boolean,
): PermissionEnablement {
  return {
    ...enablement,
    [hook.id]: enabled,
  };
}

export function findPermissionHooksByName(
  hooks: readonly RuntimePermissionHook[],
  name: string,
): RuntimePermissionHook[] {
  const normalized = name.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return hooks.filter((hook) => hook.name.toLocaleLowerCase() === normalized);
}

function getPermissionHookBaseKey(hook: RegisteredPermissionHook): string {
  return [hook.source, hook.modulePath, hook.name].map(encodeURIComponent).join("|");
}
