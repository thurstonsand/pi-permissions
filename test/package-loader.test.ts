import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadPermissionHooksFromPackages } from "../src/package-loader.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadPermissionHooksFromPackages", () => {
  it("loads package permissions declared under pi.permissions", async () => {
    const packageRoot = makePackage({ permissions: ["./permissions/deploy.ts"] });
    writePermissionModule(packageRoot, "permissions/deploy.ts", "deploy");

    const result = await loadPermissionHooksFromPackages([
      { packageRoot, source: "package:npm:deploy-tools" },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.hooks.map((hook) => hook.name)).toEqual(["deploy"]);
    expect(result.hooks[0]?.source).toBe("package:npm:deploy-tools");
    expect(result.hooks[0]?.permissionRoot).toBe(packageRoot);
  });

  it("loads convention permissions when the manifest does not declare permissions", async () => {
    const packageRoot = makePackage({ extensions: ["./extensions/index.ts"] });
    writePermissionModule(packageRoot, "permissions/default.ts", "default");

    const result = await loadPermissionHooksFromPackages([
      { packageRoot, source: "package:npm:convention-tools" },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.hooks.map((hook) => hook.name)).toEqual(["default"]);
  });

  it("allows package filters to disable permissions", async () => {
    const packageRoot = makePackage({ permissions: ["./permissions/deploy.ts"] });
    writePermissionModule(packageRoot, "permissions/deploy.ts", "deploy");

    const result = await loadPermissionHooksFromPackages([
      { packageRoot, source: "package:npm:deploy-tools", filter: [] },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.hooks).toEqual([]);
  });

  it("applies package permission include and exclude filters", async () => {
    const packageRoot = makePackage({ permissions: ["./permissions"] });
    writePermissionModule(packageRoot, "permissions/deploy.ts", "deploy");
    writePermissionModule(packageRoot, "permissions/generated.ts", "generated");

    const result = await loadPermissionHooksFromPackages([
      {
        packageRoot,
        source: "package:npm:deploy-tools",
        filter: ["permissions/*.ts", "!permissions/generated.ts"],
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.hooks.map((hook) => hook.name)).toEqual(["deploy"]);
  });

  it("applies exact package permission include filters", async () => {
    const packageRoot = makePackage({ permissions: ["./permissions"] });
    writePermissionModule(packageRoot, "permissions/deploy.ts", "deploy");
    writePermissionModule(packageRoot, "permissions/generated.ts", "generated");

    const result = await loadPermissionHooksFromPackages([
      {
        packageRoot,
        source: "package:npm:deploy-tools",
        filter: ["permissions/deploy.ts"],
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.hooks.map((hook) => hook.name)).toEqual(["deploy"]);
  });

  it("reports package source on load errors", async () => {
    const packageRoot = makePackage({ permissions: ["./permissions/missing.ts"] });

    const result = await loadPermissionHooksFromPackages([
      { packageRoot, source: "package:npm:broken-tools" },
    ]);

    expect(result.hooks).toEqual([]);
    expect(result.errors).toEqual([
      {
        source: "package:npm:broken-tools",
        path: join(packageRoot, "permissions/missing.ts"),
        error: "Permission module file does not exist",
      },
    ]);
  });
});

function makePackage(pi: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-permissions-package-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ pi }));
  return dir;
}

function writePermissionModule(packageRoot: string, path: string, name: string): void {
  const fullPath = join(packageRoot, path);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(
    fullPath,
    `export default function permissions(api) {
      api.onToolUse({
        name: ${JSON.stringify(name)},
        description: "test permission",
        handler() {},
      });
    }`,
  );
}
