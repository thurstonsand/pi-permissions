import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Pi hands extensions its own bundled typebox as a virtual module, so the copy in
// this repo is only ever a typechecking stand-in for the one that actually runs.
// A skew between them is invisible at runtime and shows up as schemas that
// typecheck here and misbehave under pi, so pin it and let this test say when the
// pin goes stale: bump `typebox` to whatever pi's next release depends on.
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe("typebox pin", () => {
  const piPinnedVersion = readJson("node_modules/@earendil-works/pi-coding-agent/package.json")
    .dependencies.typebox;

  it("installs the same typebox pi bundles", () => {
    expect(readJson("node_modules/typebox/package.json").version).toBe(piPinnedVersion);
  });

  it("declares that version exactly, so npm update cannot float off it", () => {
    expect(readJson("package.json").devDependencies.typebox).toBe(piPinnedVersion);
  });
});
