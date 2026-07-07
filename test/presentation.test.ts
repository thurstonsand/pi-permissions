import { describe, expect, it } from "vitest";
import {
  formatAgentFacingApprovalNote,
  formatAgentFacingBlockReason,
  formatAgentFacingRejectionReason,
} from "../src/presentation.js";

describe("agent-facing permission messages", () => {
  it("identifies approval notes by permission hook", () => {
    expect(
      formatAgentFacingApprovalNote({ name: "Git interference", note: "Proceed carefully." }),
    ).toBe(`Approved by user via permission hook Git interference

The user approved this tool use and provided additional context for how to proceed:
Proceed carefully.`);
  });

  it("identifies user rejections by permission hook", () => {
    expect(formatAgentFacingRejectionReason("Git interference")).toBe(
      "Blocked by user via permission hook Git interference",
    );
  });

  it("includes rejection guidance without repeating the hook as the tool", () => {
    expect(
      formatAgentFacingRejectionReason("Git interference", "Do not stage files."),
    ).toBe(`Blocked by user via permission hook Git interference

The user doesn't want to proceed with this tool use, and it was rejected. To proceed, the user said:
Do not stage files.`);
  });

  it("identifies programmatic blocks by permission hook", () => {
    expect(
      formatAgentFacingBlockReason("Dangerous delete", "Refusing recursive removal."),
    ).toBe(`Blocked by permission hook Dangerous delete

Refusing recursive removal.`);
  });
});
