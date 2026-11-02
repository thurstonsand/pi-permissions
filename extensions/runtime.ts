import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CONFIG_DIR_NAME,
  DefaultPackageManager,
  type ExtensionContext,
  getAgentDir,
  hasTrustRequiringProjectResources,
  type PackageSource,
  ProjectTrustStore,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { RegisteredPermissionHook } from "../src/api.js";
import {
  assignPermissionHookIds,
  type PermissionEnablement,
  type RuntimePermissionHook,
} from "../src/enablement.js";
import {
  discoverPermissionModules,
  loadPermissionHooksFromDir,
  type PermissionLoadError,
} from "../src/loader.js";
import {
  loadPermissionHooksFromPackages,
  type PackagePermissionSource,
} from "../src/package-loader.js";

export interface PermissionsRuntimeState {
  enablement: PermissionEnablement;
  hooks: RuntimePermissionHook[];
}

export interface LoadedPermissionsRuntime {
  hooks: RuntimePermissionHook[];
  errors: PermissionLoadError[];
  skippedUntrustedProject: boolean;
}

export async function loadRuntimeHooks(ctx: ExtensionContext): Promise<LoadedPermissionsRuntime> {
  const projectDir = join(ctx.cwd, CONFIG_DIR_NAME, "permissions");
  const trustUndecided = ctx.isProjectTrusted() && !isProjectTrustDecided(ctx.cwd);
  const projectLoads = ctx.isProjectTrusted() && !trustUndecided;
  const [projectHooks, userHooks, packageHooks] = await Promise.all([
    projectLoads ? loadPermissionHooksFromDir(projectDir, "project") : { hooks: [], errors: [] },
    loadUserPermissionHooks(),
    loadPackagePermissionHooks(ctx),
  ]);

  return {
    ...combineLoadedPermissionHooks([projectHooks, userHooks, packageHooks]),
    skippedUntrustedProject:
      trustUndecided &&
      existsSync(projectDir) &&
      discoverPermissionModules(projectDir, "project").length > 0,
  };
}

// Pi trusts a project on its own when its .pi holds nothing Pi gates, and
// permissions/ is not on that list, so isProjectTrusted() alone would run a
// freshly cloned repo's permission modules without anyone agreeing to it.
// Require that Pi gated the project itself, or that /trust saved a yes.
function isProjectTrustDecided(cwd: string): boolean {
  return (
    hasTrustRequiringProjectResources(cwd) || new ProjectTrustStore(getAgentDir()).get(cwd) === true
  );
}

async function loadUserPermissionHooks(): Promise<{
  hooks: RegisteredPermissionHook[];
  errors: PermissionLoadError[];
}> {
  return loadPermissionHooksFromDir(getUserPermissionsDir(), "user");
}

async function loadPackagePermissionHooks(
  ctx: ExtensionContext,
): Promise<{ hooks: RegisteredPermissionHook[]; errors: PermissionLoadError[] }> {
  const settingsManager = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });
  const packageManager = new DefaultPackageManager({
    cwd: ctx.cwd,
    agentDir: getAgentDir(),
    settingsManager,
  });

  return loadPermissionHooksFromPackages(
    getConfiguredPackagePermissionSources(ctx, settingsManager, packageManager),
  );
}

function combineLoadedPermissionHooks(
  results: Array<{ hooks: RegisteredPermissionHook[]; errors: PermissionLoadError[] }>,
): { hooks: RuntimePermissionHook[]; errors: PermissionLoadError[] } {
  return {
    hooks: assignPermissionHookIds(results.flatMap((result) => result.hooks)),
    errors: results.flatMap((result) => result.errors),
  };
}

function getConfiguredPackagePermissionSources(
  ctx: ExtensionContext,
  settingsManager: SettingsManager,
  packageManager: DefaultPackageManager,
): PackagePermissionSource[] {
  const packages: Array<{ pkg: PackageSource; scope: "project" | "user" }> = [];

  for (const pkg of settingsManager.getProjectSettings().packages ?? []) {
    packages.push({ pkg, scope: "project" });
  }
  for (const pkg of settingsManager.getGlobalSettings().packages ?? []) {
    packages.push({ pkg, scope: "user" });
  }

  const seen = new Set<string>();
  const result: PackagePermissionSource[] = [];

  for (const { pkg, scope } of packages) {
    const source = getPackageSourceString(pkg);
    const key = getPackageDedupeKey(source, scope, ctx.cwd);
    if (seen.has(key)) continue;
    seen.add(key);

    const packageRoot = packageManager.getInstalledPath(source, scope);
    if (!packageRoot) continue;

    const filter = getPackagePermissionsFilter(pkg);
    result.push({
      packageRoot,
      source: `package:${source}`,
      ...(filter !== undefined ? { filter } : {}),
    });
  }

  return result;
}

function getPackageSourceString(pkg: PackageSource): string {
  return typeof pkg === "string" ? pkg : pkg.source;
}

function getPackagePermissionsFilter(pkg: PackageSource): string[] | undefined {
  if (typeof pkg === "string") return undefined;
  const maybeFilter = (pkg as { permissions?: unknown }).permissions;
  return Array.isArray(maybeFilter)
    ? maybeFilter.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function getPackageDedupeKey(source: string, scope: "project" | "user", cwd: string): string {
  if (source.startsWith("npm:")) return `npm:${getNpmPackageName(source)}`;
  if (isGitPackageSource(source)) return `git:${getGitPackageIdentity(source)}`;
  const baseDir = scope === "project" ? join(cwd, CONFIG_DIR_NAME) : getAgentDir();
  return `local:${resolve(baseDir, source)}`;
}

function getNpmPackageName(source: string): string {
  const spec = source.slice("npm:".length);
  if (spec.startsWith("@")) {
    const slashIndex = spec.indexOf("/");
    if (slashIndex === -1) return spec;
    const versionIndex = spec.indexOf("@", slashIndex);
    return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
  }

  const versionIndex = spec.indexOf("@");
  return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
}

function isGitPackageSource(source: string): boolean {
  return (
    source.startsWith("git:") ||
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.startsWith("ssh://") ||
    source.startsWith("git://")
  );
}

function getGitPackageIdentity(source: string): string {
  const withoutPrefix = source.startsWith("git:") ? source.slice("git:".length) : source;
  const lastSlashIndex = Math.max(withoutPrefix.lastIndexOf("/"), withoutPrefix.lastIndexOf(":"));
  const refIndex = withoutPrefix.indexOf("@", lastSlashIndex + 1);
  const withoutRef = refIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, refIndex);
  return withoutRef
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\//, "")
    .replace(/\.git$/, "");
}

export function getUserPermissionsDir(): string {
  return process.env.PI_PERMISSIONS_USER_DIR ?? join(getAgentDir(), "permissions");
}

export function notifyLoadProblems(ctx: ExtensionContext, loaded: LoadedPermissionsRuntime): void {
  if (!ctx.hasUI) return;
  if (loaded.skippedUntrustedProject) {
    ctx.ui.notify(
      `Project permissions in ${CONFIG_DIR_NAME}/permissions were not loaded because this project has no trust decision. Run /trust and restart pi to load them.`,
      "warning",
    );
  }
  for (const error of loaded.errors) {
    ctx.ui.notify(`Failed to load permission module ${error.path}: ${error.error}`, "warning");
  }
}
