import { afterEach, describe, expect, it } from "vitest";

import { getUserPermissionsDir } from "../extensions/runtime.js";

const originalUserDir = process.env.PI_PERMISSIONS_USER_DIR;

afterEach(() => {
  restoreEnv("PI_PERMISSIONS_USER_DIR", originalUserDir);
});

describe("permission directory overrides", () => {
  it("uses a user permission directory override for smoke tests and manual validation", () => {
    process.env.PI_PERMISSIONS_USER_DIR = "/tmp/user-permissions";

    expect(getUserPermissionsDir()).toBe("/tmp/user-permissions");
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
