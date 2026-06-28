import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadPermissionHooksFromDir } from "../src/loader.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadPermissionHooksFromDir", () => {
  it("loads top-level permission modules", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "rules.ts"),
      `export default function permissions(api) {
        api.onToolUse({
          name: "top-level",
          description: "loaded from a top-level file",
          handler() {},
        });
      }`,
    );

    const result = await loadPermissionHooksFromDir(dir);

    expect(result.errors).toEqual([]);
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]?.name).toBe("top-level");
    expect(result.hooks[0]?.permissionRoot).toBe(dir);
  });

  it("allows permission modules to import pi-permissions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, "rules.ts"),
      `import { matchTool } from "pi-permissions";

      export default function permissions(api) {
        api.onToolUse({
          name: "with import",
          description: "uses the package public API",
          handler(input) { return matchTool(input.tool, { default: () => undefined }); },
        });
      }`,
    );

    const result = await loadPermissionHooksFromDir(dir);

    expect(result.errors).toEqual([]);
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]?.name).toBe("with import");
  });

  it("loads package permission modules declared under pi.permissions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-permissions-"));
    const packageDir = join(dir, "package-policy");
    tempDirs.push(dir);
    writeFileSync(join(dir, "ignored.txt"), "nope");
    mkdirSync(packageDir);
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ pi: { permissions: ["./index.ts"] } }),
    );
    writeFileSync(
      join(packageDir, "index.ts"),
      `export default function permissions(api) {
        api.onToolUse({
          name: "package",
          description: "loaded from package metadata",
          handler() {},
        });
      }`,
    );

    const result = await loadPermissionHooksFromDir(dir);

    expect(result.errors).toEqual([]);
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]?.name).toBe("package");
    expect(result.hooks[0]?.permissionRoot).toBe(packageDir);
  });
});
