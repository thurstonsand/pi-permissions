import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { PermissionHighlight } from "../src/highlight.js";
import { openExternalEditor } from "../src/ui/external-editor.js";
import { type PermissionGateResult, showPermissionGate } from "../src/ui/permission-prompt.js";

vi.mock("../src/ui/external-editor.js", () => ({ openExternalEditor: vi.fn() }));

const KEY = {
  enter: "\r",
  escape: "\x1b",
  tab: "\t",
  shiftTab: "\x1b[Z",
  up: "\x1b[A",
  down: "\x1b[B",
  backspace: "\x7f",
  ctrlR: "\x12",
  ctrlG: "\x07",
} as const;

const LABELS = { approveLabel: "Authorize", rejectLabel: "Abort", editLabel: "Edit" };

type Overlay = {
  handleInput(data: string): void;
  render(width: number): string[];
  focused: boolean;
};

type Harness = {
  overlay: Overlay;
  result(): PermissionGateResult | undefined;
  type(...keys: string[]): void;
  render(): string[];
};

function mount(
  editable?: { command: string },
  opts?: { highlight?: PermissionHighlight },
): Harness {
  let overlay: Overlay | undefined;
  let result: PermissionGateResult | undefined;

  const theme = {
    // Make the warning color visible so highlighted fragments are observable.
    fg: (color: string, text: string) => (color === "warning" ? `[[${text}]]` : text),
    bold: (text: string) => text,
    inverse: (text: string) => text,
  };
  const tui = {
    requestRender() {},
    terminal: { rows: 40, cols: 80 },
    stop() {},
    start() {},
  };
  const keybindings = {
    matches: (data: string, id: string) => id === "app.editor.external" && data === KEY.ctrlG,
  };

  const ctx = {
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    ui: {
      theme,
      custom<T>(
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: (value: T) => void,
        ) => Overlay,
      ): Promise<T> {
        return new Promise<T>((resolve) => {
          overlay = factory(tui, theme, keybindings, resolve as (value: T) => void);
          overlay.focused = true;
        });
      },
    },
  } as unknown as ExtensionContext;

  void showPermissionGate(ctx, {
    name: "! Authorization required: Git",
    header: "message",
    toolName: "bash",
    detail: editable?.command ?? "some detail",
    labels: LABELS,
    ...(opts?.highlight !== undefined ? { highlight: opts.highlight } : {}),
    ...(editable ? { editable } : {}),
  }).then((value) => {
    result = value;
  });

  if (!overlay) throw new Error("overlay not mounted");

  return {
    overlay,
    result: () => result,
    type: (...keys: string[]) => {
      for (const key of keys) overlay?.handleInput(key);
    },
    render: () => overlay?.render(60) ?? [],
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("permission prompt edit mode", () => {
  it("edits a bash command and returns the edited command", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", "X", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "edit", command: "git commit -m hiX" });
  });

  it("degrades an unchanged submit to a plain approval", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "allow" });
  });

  it("keeps an unchanged submit with a note as approve-with-note", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", KEY.tab, "n", "o", "t", "e", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", note: "note" });
  });

  it("emits a full edit note when the command changed and a note was given", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", "X", KEY.tab, "w", "h", "y", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "edit", command: "git commit -m hiX", note: "why" });
  });

  it("runs the original command when the edit is escaped then authorized", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", "X", KEY.escape, "1");
    await flush();
    expect(h.result()).toEqual({ kind: "allow" });
  });

  it("retains the note draft across an escape back to select mode", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", KEY.tab, "k", "e", "e", "p", KEY.escape, "2", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", note: "keep" });
  });

  it("seeds the note field from the Edit choice's tab draft", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type(KEY.down, KEY.tab, "s", "e", "e", "d", KEY.enter, KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", note: "seed" });
  });

  it("refuses a blank command and shows a warning without resolving", async () => {
    const h = mount({ command: "x" });
    h.type("2", KEY.backspace, KEY.enter);
    await flush();
    expect(h.result()).toBeUndefined();
    expect(h.render().join("\n")).toContain("An empty command achieves nothing");
  });

  it("runs the expanded paste content, not the collapsed marker, when submitting from the note field", async () => {
    const h = mount({ command: "git commit -m hi" });
    const pasted = `echo ${"a".repeat(1100)}`;
    h.type("2", `\x1b[200~${pasted}\x1b[201~`);
    // submit from the note field, the path that previously used raw getText()
    h.type(KEY.tab, KEY.enter);
    await flush();
    const result = h.result();
    expect(result?.kind).toBe("edit");
    expect(result).toEqual({ kind: "edit", command: `git commit -m hi${pasted}` });
    expect((result as { command: string }).command).not.toContain("[paste #");
  });

  it("ctrl+r toggles between edits and the original, preserving edits on round trip", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", "X"); // buffer: "git commit -m hiX"
    h.type(KEY.ctrlR); // stash edits, show original
    expect(h.render().join("\n")).toContain("git commit -m hi");
    h.type(KEY.ctrlR); // swap the edits back in
    h.type(KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "edit", command: "git commit -m hiX" });
  });

  it("submits the original as a plain approval when ctrl+r is showing it", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", "X", KEY.ctrlR, KEY.enter); // edit, toggle to original, submit
    await flush();
    expect(h.result()).toEqual({ kind: "allow" });
  });

  it("discards the stash when the buffer is modified while showing the original", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", "X"); // buffer: "git commit -m hiX"
    h.type(KEY.ctrlR); // stash X, show original
    h.type("Y"); // modify original -> stash discarded, buffer: "git commit -m hiY"
    h.type(KEY.ctrlR, KEY.ctrlR); // round trip must preserve Y, not resurrect X
    const buffer = h.render().join("\n");
    expect(buffer).toContain("git commit -m hiY");
    expect(buffer).not.toContain("git commit -m hiX");
  });

  it("preserves the stash across esc and re-entering edit mode", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", "X", KEY.ctrlR); // stash X, show original
    h.type(KEY.escape, "2"); // back to select, re-enter edit
    h.type(KEY.ctrlR); // restore the stashed edits
    h.type(KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "edit", command: "git commit -m hiX" });
  });

  it("treats an external-editor return as a modification that discards the stash", async () => {
    vi.mocked(openExternalEditor).mockResolvedValue("git commit -m external");
    const h = mount({ command: "git commit -m hi" });
    h.type("2", "X"); // buffer: "git commit -m hiX"
    h.type(KEY.ctrlR); // stash X, show original
    h.type(KEY.ctrlG); // external editor returns a modification
    await flush();
    // the return replaced the buffer and discarded the stash: a round trip
    // preserves the external content rather than resurrecting "hiX"
    h.type(KEY.ctrlR, KEY.ctrlR);
    const buffer = h.render().join("\n");
    expect(buffer).toContain("git commit -m external");
    expect(buffer).not.toContain("git commit -m hiX");
  });

  it("keeps j/k navigating onto a choice that carries a note draft", async () => {
    const h = mount({ command: "git commit -m hi" });
    // put a note on the Edit choice, close editing, move back to Authorize
    h.type(KEY.down, KEY.tab, "n", "o", "t", "e", KEY.shiftTab, KEY.up);
    // j moves onto Edit (which carries the note); k must move back off rather
    // than type into the note
    h.type("j", "k", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "allow" });
  });

  it("toggles fields with shift+tab as well as tab", async () => {
    const h = mount({ command: "git commit -m hi" });
    // enter edit (command focused), shift+tab to the note field, type a note
    h.type("2", KEY.shiftTab, "n", "o", "t", "e", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", note: "note" });
  });

  it("shows one cursor and a contextual legend as focus moves between fields", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2");
    // command field: editor paints its inverse cursor, shift+enter is offered
    const command = h.render().join("\n");
    expect(command).toContain("\x1b[7m");
    expect(command).toContain("shift+enter");

    h.type(KEY.tab);
    // note field: command editor cursor is stripped, shift+enter is hidden
    const note = h.render().join("\n");
    expect(note).not.toContain("\x1b[7m");
    expect(note).not.toContain("shift+enter");
  });

  it("previews the edited command plain under Edit, the highlighted original otherwise", async () => {
    const h = mount({ command: "git stash lst" }, { highlight: /git stash \w+/ });
    // Accept highlighted: original with its frozen highlight
    expect(h.render().join("\n")).toContain("bash: [[git stash lst]]");

    // edit, esc back with Edit highlighted: the live buffer, no highlight
    h.type("2", "X", KEY.escape);
    const edit = h.render().join("\n");
    expect(edit).toContain("bash: git stash lstX");
    expect(edit).not.toContain("[[");

    // move up to Accept: the original with its highlight again, not the edit
    h.type(KEY.up);
    const accept = h.render().join("\n");
    expect(accept).toContain("bash: [[git stash lst]]");
    expect(accept).not.toContain("git stash lstX");
  });

  it("offers no edit choice for non-bash tool calls", async () => {
    const h = mount();
    expect(h.render().join("\n")).not.toContain("Edit");
    h.type("2");
    await flush();
    expect(h.result()).toEqual({ kind: "reject", abort: true });
  });
});
