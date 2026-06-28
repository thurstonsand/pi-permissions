import { describe, expect, it } from "vitest";

import type { PermissionDecision } from "../src/index.js";

describe("pi-permissions", () => {
  it("exports the permission decision contract", () => {
    const decision: PermissionDecision = { decision: "pass" };

    expect(decision.decision).toBe("pass");
  });
});
