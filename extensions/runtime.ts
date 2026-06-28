import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { RegisteredPermissionHook } from "../src/api.js";
import { loadPermissionHooksFromDir, type PermissionLoadError } from "../src/loader.js";

export interface PermissionsRuntimeState {
  enabled: boolean;
  hooks: RegisteredPermissionHook[];
}

export interface LoadedPermissionsRuntime {
  hooks: RegisteredPermissionHook[];
  errors: PermissionLoadError[];
}

export async function loadRuntimeHooks(ctx: ExtensionContext): Promise<LoadedPermissionsRuntime> {
  const projectHooks = ctx.isProjectTrusted()
    ? await loadPermissionHooksFromDir(join(ctx.cwd, CONFIG_DIR_NAME, "permissions"))
    : { hooks: [], errors: [] };
  const userHooks = await loadPermissionHooksFromDir(join(getAgentDir(), "permissions"));
  return {
    hooks: [...projectHooks.hooks, ...userHooks.hooks],
    errors: [...projectHooks.errors, ...userHooks.errors],
  };
}

export function notifyLoadErrors(ctx: ExtensionContext, errors: PermissionLoadError[]): void {
  if (!ctx.hasUI) return;
  for (const error of errors) {
    ctx.ui.notify(`Failed to load permission module ${error.path}: ${error.error}`, "warning");
  }
}
