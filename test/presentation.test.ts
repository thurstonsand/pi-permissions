import { describe, expect, it } from "vitest";
import {
  formatAgentFacingApprovalNote,
  formatAgentFacingBlockReason,
  formatAgentFacingEditNote,
  formatAgentFacingRejectionReason,
  formatHumanFacingPermissionPrompt,
  formatToolDetailLine,
} from "../src/presentation.js";

describe("human-facing permission prompts", () => {
  it("returns the header (description and guidance) and labels", () => {
    expect(
      formatHumanFacingPermissionPrompt({
        hookName: "Git interference",
        description: "Git staging is reserved for the approver.",
        toolName: "bash",
        toolDetail: "npm test && git add -A && echo done",
        prompt: {
          guidance: "Review the command chain.",
          highlight: /git add\b/,
        },
      }),
    ).toEqual({
      name: "! Authorization required: Git interference",
      header: `Git staging is reserved for the approver.

Review the command chain.`,
      approveLabel: "Authorize",
      editLabel: "Edit",
      rejectLabel: "Abort",
    });
  });
});

describe("tool detail line", () => {
  it("emphasizes highlighted fragments only", () => {
    expect(
      formatToolDetailLine(
        "bash",
        "npm test && git add -A && echo done",
        /git add\b/,
        (fragment) => `<<${fragment}>>`,
      ),
    ).toBe("bash: npm test && <<git add>> -A && echo done");
  });

  it("emphasizes each line of a multi-line span independently", () => {
    const detail = "cat <<EOF\nfeat: change\nEOF\ngit commit -F msg";
    expect(
      formatToolDetailLine(
        "bash",
        detail,
        [{ start: 0, end: detail.length }],
        (fragment) => `<<${fragment}>>`,
      ),
    ).toBe(
      `bash: <<cat <<EOF>>
<<feat: change>>
<<EOF>>
<<git commit -F msg>>`,
    );
  });
});

describe("agent-facing permission messages", () => {
  it("identifies approval notes by permission hook", () => {
    expect(
      formatAgentFacingApprovalNote({ hookName: "Git interference", note: "Proceed carefully." }),
    ).toBe(`Approved by user via permission hook Git interference

The user approved this tool use and provided additional context for how to proceed:
Proceed carefully.`);
  });

  it("reports the command that actually ran after an edit", () => {
    expect(
      formatAgentFacingEditNote({
        hookName: "Git interference",
        command: 'git commit -m "fix wording in readme"',
      }),
    ).toBe(`Edited by user via permission hook Git interference

The user edited this command before execution. The command that actually ran:
git commit -m "fix wording in readme"`);
  });

  it("appends approver context to an edit note when present", () => {
    expect(
      formatAgentFacingEditNote({
        hookName: "Git interference",
        command: 'git commit -m "fix wording in readme"',
        note: "Reworded the message.",
      }),
    ).toBe(`Edited by user via permission hook Git interference

The user edited this command before execution. The command that actually ran:
git commit -m "fix wording in readme"

The user also provided context for how to proceed:
Reworded the message.`);
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
