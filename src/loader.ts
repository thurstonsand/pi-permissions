import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as _bundledPiAgentCore from "@earendil-works/pi-agent-core";
import * as _bundledPiAiCompat from "@earendil-works/pi-ai/compat";
import * as _bundledPiAiOauth from "@earendil-works/pi-ai/oauth";
import * as _bundledPiCodingAgent from "@earendil-works/pi-coding-agent";
import * as _bundledPiTui from "@earendil-works/pi-tui";
import { createJiti } from "jiti/static";
import * as _bundledTypebox from "typebox";
import * as _bundledTypeboxCompile from "typebox/compile";
import * as _bundledTypeboxValue from "typebox/value";
import type {
  PermissionSource,
  PermissionsAPI,
  RegisteredPermissionHook,
  ToolUsePermissionHook,
} from "./api.js";

export type PermissionModuleFactory = (api: PermissionsAPI) => void | Promise<void>;

const PERMISSION_MODULE_VIRTUAL_MODULES: Record<string, unknown> = {
  "@earendil-works/pi-agent-core": _bundledPiAgentCore,
  "@earendil-works/pi-ai": _bundledPiAiCompat,
  "@earendil-works/pi-ai/compat": _bundledPiAiCompat,
  "@earendil-works/pi-ai/oauth": _bundledPiAiOauth,
  "@earendil-works/pi-coding-agent": _bundledPiCodingAgent,
  "@earendil-works/pi-tui": _bundledPiTui,
  typebox: _bundledTypebox,
  "typebox/compile": _bundledTypeboxCompile,
  "typebox/value": _bundledTypeboxValue,
  "@sinclair/typebox": _bundledTypebox,
  "@sinclair/typebox/compile": _bundledTypeboxCompile,
  "@sinclair/typebox/value": _bundledTypeboxValue,
};

export interface LoadedPermissionHooks {
  hooks: RegisteredPermissionHook[];
  errors: PermissionLoadError[];
}

export interface PermissionLoadError {
  source: PermissionSource;
  path: string;
  error: string;
}

export interface PermissionModuleCandidate {
  source: PermissionSource;
  path: string;
  permissionRoot: string;
}

export async function loadPermissionHooksFromDir(
  dir: string,
  source: PermissionSource,
): Promise<LoadedPermissionHooks> {
  if (!existsSync(dir)) return { hooks: [], errors: [] };

  const candidates = discoverPermissionModules(dir, source);
  const allHooks: RegisteredPermissionHook[] = [];
  const errors: PermissionLoadError[] = [];

  for (const candidate of candidates) {
    const result = await loadPermissionModule(candidate);
    allHooks.push(...result.hooks);
    errors.push(...result.errors);
  }

  return { hooks: allHooks, errors };
}

export async function loadPermissionHooksFromCandidates(
  candidates: PermissionModuleCandidate[],
): Promise<LoadedPermissionHooks> {
  const allHooks: RegisteredPermissionHook[] = [];
  const errors: PermissionLoadError[] = [];

  for (const candidate of candidates) {
    const result = await loadPermissionModule(candidate);
    allHooks.push(...result.hooks);
    errors.push(...result.errors);
  }

  return { hooks: allHooks, errors };
}

export function discoverPermissionModules(
  dir: string,
  source: PermissionSource,
): PermissionModuleCandidate[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const candidates: PermissionModuleCandidate[] = [];

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);

    if (entry.isFile() && isLoadableModuleFile(entry.name)) {
      candidates.push({ source, path: entryPath, permissionRoot: dir });
      continue;
    }

    if (!entry.isDirectory()) continue;

    const manifestPath = join(entryPath, "package.json");
    if (!existsSync(manifestPath)) continue;

    for (const modulePath of readPackagePermissionEntries(manifestPath)) {
      candidates.push({ source, path: resolve(entryPath, modulePath), permissionRoot: entryPath });
    }
  }

  return candidates;
}

async function loadPermissionModule(
  candidate: PermissionModuleCandidate,
): Promise<LoadedPermissionHooks> {
  const hooks: RegisteredPermissionHook[] = [];
  const errors: PermissionLoadError[] = [];

  if (!existsSync(candidate.path) || !statSync(candidate.path).isFile()) {
    return {
      hooks,
      errors: [
        {
          source: candidate.source,
          path: candidate.path,
          error: "Permission module file does not exist",
        },
      ],
    };
  }

  try {
    const jiti = createJiti(import.meta.url, {
      moduleCache: false,
      alias: getPermissionModuleAliases(),
      virtualModules: PERMISSION_MODULE_VIRTUAL_MODULES,
    });
    const factory = await jiti.import<PermissionModuleFactory>(candidate.path, { default: true });

    if (typeof factory !== "function") {
      return {
        hooks,
        errors: [
          {
            source: candidate.source,
            path: candidate.path,
            error: "Permission module must default-export a function",
          },
        ],
      };
    }

    const api: PermissionsAPI = {
      onToolUse(hook) {
        hooks.push(registerHook(candidate, hook));
      },
    };

    await factory(api);
    return { hooks, errors };
  } catch (error) {
    return {
      hooks,
      errors: [
        {
          source: candidate.source,
          path: candidate.path,
          error: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function registerHook(
  candidate: PermissionModuleCandidate,
  hook: ToolUsePermissionHook,
): RegisteredPermissionHook {
  return {
    ...hook,
    source: candidate.source,
    permissionRoot: candidate.permissionRoot,
    modulePath: candidate.path,
  };
}

function readPackagePermissionEntries(manifestPath: string): string[] {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    return getPackagePermissionEntries(manifest);
  } catch {
    return [];
  }
}

function getPackagePermissionEntries(manifest: unknown): string[] {
  if (!isRecord(manifest)) return [];
  if (!isRecord(manifest.pi)) return [];
  if (!Array.isArray(manifest.pi.permissions)) return [];
  return manifest.pi.permissions.filter((entry): entry is string => typeof entry === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getPermissionModuleAliases(): Record<string, string> {
  return {
    "@thurstonsand/pi-permissions": fileURLToPath(new URL("./index.ts", import.meta.url)),
  };
}

function isLoadableModuleFile(name: string): boolean {
  return (
    name.endsWith(".ts") || name.endsWith(".js") || name.endsWith(".mjs") || name.endsWith(".cjs")
  );
}
