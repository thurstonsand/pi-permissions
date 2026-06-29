import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { minimatch } from "minimatch";
import type { PermissionSource } from "./api.js";
import {
  type LoadedPermissionHooks,
  loadPermissionHooksFromCandidates,
  type PermissionModuleCandidate,
} from "./loader.js";

export interface PackagePermissionSource {
  packageRoot: string;
  source: PermissionSource;
  filter?: string[];
}

interface PackagePermissionManifest {
  permissions?: string[];
}

const LOADABLE_MODULE_PATTERN = /\.(ts|js|mjs|cjs)$/;

export async function loadPermissionHooksFromPackages(
  packages: PackagePermissionSource[],
): Promise<LoadedPermissionHooks> {
  const candidates = packages.flatMap(discoverPackagePermissionCandidates);
  return loadPermissionHooksFromCandidates(candidates);
}

export function discoverPackagePermissionCandidates(
  pkg: PackagePermissionSource,
): PermissionModuleCandidate[] {
  const paths = collectPackagePermissionFiles(pkg.packageRoot, pkg.filter);
  return paths.map((path) => ({ source: pkg.source, path, permissionRoot: pkg.packageRoot }));
}

function collectPackagePermissionFiles(
  packageRoot: string,
  filter: string[] | undefined,
): string[] {
  const defaultFiles = collectDefaultPermissionFiles(packageRoot);
  if (filter === undefined) return defaultFiles;
  if (filter.length === 0) return [];
  return applyPatterns(defaultFiles, filter, packageRoot);
}

function collectDefaultPermissionFiles(packageRoot: string): string[] {
  const manifest = readPackagePermissionManifest(packageRoot);
  if (manifest.permissions) {
    const allFiles = collectFilesFromEntries(manifest.permissions, packageRoot);
    return applyPatterns(allFiles, manifest.permissions.filter(isOverridePattern), packageRoot);
  }

  const conventionDir = join(packageRoot, "permissions");
  if (!existsSync(conventionDir)) return [];
  return collectLoadableFiles(conventionDir);
}

function readPackagePermissionManifest(packageRoot: string): PackagePermissionManifest {
  try {
    const content = readFileSync(join(packageRoot, "package.json"), "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) return {};
    if (!isRecord(parsed.pi)) return {};
    if (!Object.hasOwn(parsed.pi, "permissions")) return {};
    if (!Array.isArray(parsed.pi.permissions)) return { permissions: [] };
    return {
      permissions: parsed.pi.permissions.filter(
        (entry): entry is string => typeof entry === "string",
      ),
    };
  } catch {
    return {};
  }
}

function collectFilesFromEntries(entries: string[], packageRoot: string): string[] {
  const sourceEntries = entries.filter((entry) => !isOverridePattern(entry));
  let allPackageFiles: string[] | undefined;
  const files: string[] = [];

  for (const entry of sourceEntries) {
    if (hasGlobPattern(entry)) {
      allPackageFiles ??= collectLoadableFiles(packageRoot);
      files.push(...allPackageFiles.filter((file) => matchesPattern(file, entry, packageRoot)));
      continue;
    }

    const path = resolve(packageRoot, entry);
    const entryFiles = collectFilesFromPath(path);
    files.push(...(entryFiles.length > 0 ? entryFiles : [path]));
  }

  return Array.from(new Set(files));
}

function collectFilesFromPath(path: string): string[] {
  if (!existsSync(path)) return [];

  try {
    const stats = statSync(path);
    if (stats.isFile() && isLoadableModuleFile(path)) return [path];
    if (stats.isDirectory()) return collectLoadableFiles(path);
  } catch {
    return [];
  }

  return [];
}

function collectLoadableFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const path = join(dir, entry.name);
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(path);
          isDirectory = stats.isDirectory();
          isFile = stats.isFile();
        } catch {
          continue;
        }
      }

      if (isDirectory) {
        files.push(...collectLoadableFiles(path));
      } else if (isFile && isLoadableModuleFile(path)) {
        files.push(path);
      }
    }
  } catch {
    return files;
  }

  return files;
}

function applyPatterns(files: string[], patterns: string[], packageRoot: string): string[] {
  const includes: string[] = [];
  const excludes: string[] = [];
  const forceIncludes: string[] = [];
  const forceExcludes: string[] = [];

  for (const pattern of patterns) {
    if (pattern.startsWith("+")) {
      forceIncludes.push(pattern.slice(1));
    } else if (pattern.startsWith("-")) {
      forceExcludes.push(pattern.slice(1));
    } else if (pattern.startsWith("!")) {
      excludes.push(pattern.slice(1));
    } else {
      includes.push(pattern);
    }
  }

  let result =
    includes.length === 0
      ? [...files]
      : files.filter((file) => matchesAnyPattern(file, includes, packageRoot));

  if (excludes.length > 0) {
    result = result.filter((file) => !matchesAnyPattern(file, excludes, packageRoot));
  }

  if (forceIncludes.length > 0) {
    for (const file of files) {
      if (!result.includes(file) && matchesAnyExactPattern(file, forceIncludes, packageRoot)) {
        result.push(file);
      }
    }
  }

  if (forceExcludes.length > 0) {
    result = result.filter((file) => !matchesAnyExactPattern(file, forceExcludes, packageRoot));
  }

  return Array.from(new Set(result));
}

function matchesAnyPattern(file: string, patterns: string[], packageRoot: string): boolean {
  return patterns.some((pattern) => matchesPattern(file, pattern, packageRoot));
}

function matchesPattern(file: string, pattern: string, packageRoot: string): boolean {
  const normalizedPattern = toPosixPath(pattern);
  const rel = toPosixPath(relative(packageRoot, file));
  const name = basename(file);
  const filePosix = toPosixPath(file);
  return (
    minimatch(rel, normalizedPattern) ||
    minimatch(name, normalizedPattern) ||
    minimatch(filePosix, normalizedPattern)
  );
}

function matchesAnyExactPattern(file: string, patterns: string[], packageRoot: string): boolean {
  const rel = toPosixPath(relative(packageRoot, file));
  const name = basename(file);
  const filePosix = toPosixPath(file);

  return patterns.some((pattern) => {
    const normalized = normalizeExactPattern(pattern);
    return normalized === rel || normalized === name || normalized === filePosix;
  });
}

function normalizeExactPattern(pattern: string): string {
  const normalized =
    pattern.startsWith("./") || pattern.startsWith(".\\") ? pattern.slice(2) : pattern;
  return toPosixPath(normalized);
}

function isOverridePattern(value: string): boolean {
  return value.startsWith("!") || value.startsWith("+") || value.startsWith("-");
}

function hasGlobPattern(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

function isLoadableModuleFile(path: string): boolean {
  return LOADABLE_MODULE_PATTERN.test(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}
