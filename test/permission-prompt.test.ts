import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
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
  ctrlS: "\x13",
} as const;

const LABELS = { approveLabel: "Authorize", rejectLabel: "Abort", editLabel: "Edit" };

type Overlay = {
  handleInput(data: string): void;
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined;
  render(width: number): string[];
  focused: boolean;
};

type Harness = {
  overlay: Overlay;
  result(): PermissionGateResult | undefined;
  type(...keys: string[]): void;
  render(): string[];
  /** Component row carrying the first rendered line that contains `needle`. */
  rowOf(needle: string): number;
  mouse(
    type: TuiMouseEvent["type"],
    y: number,
    extra?: Partial<TuiMouseEvent>,
  ): TuiMouseEventResult | undefined;
};

const WIDTH = 60;

function mount(
  editable?: { command: string },
  opts?: { highlight?: PermissionHighlight },
): Harness {
  let overlay: Overlay | undefined;
  let result: PermissionGateResult | undefined;

  const theme = {
    // Make the warning color visible so highlighted fragments are observable.
    fg: (color: string, text: string) => (color === "warning" ? `[[${text}]]` : text),
    bg: (_color: string, text: string) => `\x1b[44m${text}\x1b[49m`,
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
    render: () => overlay?.render(WIDTH) ?? [],
    rowOf: (needle: string) => {
      const row = (overlay?.render(WIDTH) ?? []).findIndex((line) => line.includes(needle));
      if (row < 0) throw new Error(`No rendered line contains ${JSON.stringify(needle)}`);
      return row;
    },
    mouse: (type, y, extra) =>
      overlay?.handleMouse({
        type,
        button: type === "wheel" ? "none" : "left",
        x: 4,
        y,
        screenX: 4,
        screenY: y,
        width: WIDTH,
        height: 40,
        shift: false,
        alt: false,
        ctrl: false,
        ...extra,
      }),
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
    expect(h.render().join("\n")).toContain("[[git stash lst]]");

    // edit, esc back with Edit highlighted: the live buffer, no highlight
    h.type("2", "X", KEY.escape);
    const edit = h.render().join("\n");
    expect(edit).toContain("git stash lstX");
    expect(edit).not.toContain("[[");

    // move up to Accept: the original with its highlight again, not the edit
    h.type(KEY.up);
    const accept = h.render().join("\n");
    expect(accept).toContain("[[git stash lst]]");
    expect(accept).not.toContain("git stash lstX");
  });

  it("frames the detail in an inner box labeled with the tool name", () => {
    const h = mount({ command: "git commit -m hi" });
    const lines = h.render();
    const top = lines.findIndex((line) => line.includes("╭─ bash "));
    const bottom = lines.findIndex((line) => line.includes("╰"));

    expect(top).toBeGreaterThan(-1);
    expect(bottom).toBeGreaterThan(top);
    expect(lines.slice(top + 1, bottom).join("\n")).toContain("git commit -m hi");
  });

  it("offers no edit choice for non-bash tool calls", async () => {
    const h = mount();
    expect(h.render().join("\n")).not.toContain("Edit");
    h.type("2");
    await flush();
    expect(h.result()).toEqual({ kind: "reject", abort: true });
  });
});

describe("permission prompt body scrolling", () => {
  const longCommand = `git commit -m "${"word ".repeat(400)}TAIL_MARKER"`;

  it("windows a tall body so the options and legend stay on screen", () => {
    const h = mount({ command: longCommand });
    const lines = h.render();
    const text = lines.join("\n");

    // fits the 40-row terminal from the mount harness
    expect(lines.length).toBeLessThanOrEqual(38);
    expect(text).toContain("Authorize");
    expect(text).toContain("↑↓ select");
    expect(text).toContain("f/b scroll");
    expect(text).toContain("↓");
    expect(text).toContain("more");
    expect(text).not.toContain("TAIL_MARKER");
  });

  it("pages forward with f and back with b, marking off-screen lines in the borders", () => {
    const h = mount({ command: longCommand });
    h.render(); // establish the window before scrolling

    h.type("f");
    const scrolled = h.render().join("\n");
    expect(scrolled).toContain("TAIL_MARKER");
    expect(scrolled).toMatch(/↑ \d+/);

    h.type("b");
    const back = h.render().join("\n");
    expect(back).not.toContain("TAIL_MARKER");
    expect(back).toMatch(/↓ \d+ more/);
    expect(back).not.toMatch(/↑ \d+/);
  });

  it("leaves f/b inert and unwindowed when the body fits", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.render();
    h.type("f", "b");
    const text = h.render().join("\n");
    expect(text).not.toContain("f/b scroll");
    expect(text).not.toContain("more");
    expect(h.result()).toBeUndefined();
  });

  it("still types f and b into an open note draft", async () => {
    const h = mount({ command: longCommand });
    h.render();
    h.type(KEY.tab, "f", "b", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", note: "fb" });
  });
});

describe("permission prompt mouse", () => {
  const longCommand = `git commit -m "${"word ".repeat(400)}TAIL_MARKER"`;

  it("authorizes when an option is pressed and released", async () => {
    const h = mount({ command: "git commit -m hi" });
    const row = h.rowOf("1. Authorize");

    h.mouse("press", row);
    h.mouse("click", row);
    await flush();

    expect(h.result()).toEqual({ kind: "allow" });
  });

  it("aborts on a click three rows down the option list", async () => {
    const h = mount({ command: "git commit -m hi" });
    const row = h.rowOf("3. Abort");

    h.mouse("press", row);
    h.mouse("click", row);
    await flush();

    expect(h.result()).toEqual({ kind: "reject", abort: true });
  });

  it("moves the highlight on press without deciding anything", () => {
    const h = mount({ command: "git commit -m hi" });

    const result = h.mouse("press", h.rowOf("2. Edit"));

    expect(result).toEqual({ handled: true, focus: true, render: true });
    expect(h.render().join("\n")).toContain("→ 2. Edit");
    expect(h.result()).toBeUndefined();
  });

  it("leaves hover alone so the pointer cannot arm the enter key", () => {
    const h = mount({ command: "git commit -m hi" });

    expect(h.mouse("move", h.rowOf("3. Abort"))).toBeUndefined();
    expect(h.render().join("\n")).toContain("→ 1. Authorize");
  });

  it("ignores clicks that land outside the option rows", async () => {
    const h = mount({ command: "git commit -m hi" });

    expect(h.mouse("click", h.rowOf("↑↓ select"))).toBeUndefined();
    await flush();
    expect(h.result()).toBeUndefined();
  });

  it("declines a click on the frame padding right of an option", async () => {
    const h = mount({ command: "git commit -m hi" });
    const row = h.rowOf("1. Authorize");

    expect(h.mouse("press", row, { x: 2 + "  1. Authorize".length })).toBeUndefined();
    expect(h.mouse("click", row, { x: 40 })).toBeUndefined();
    await flush();

    expect(h.result()).toBeUndefined();
  });

  it("still takes a click past the end of an open note, as a text field would", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type(KEY.tab, "a", "b");
    const row = h.rowOf("1. Authorize");

    h.mouse("click", row, { x: 50 });
    h.type("c", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "allow", note: "abc" });
  });

  it("confirms from the enter hint and aborts from the esc hint", async () => {
    const confirmed = mount({ command: "git commit -m hi" });
    const confirmRow = confirmed.rowOf("enter confirm");
    const confirmLine = confirmed.render()[confirmRow] ?? "";
    confirmed.mouse("click", confirmRow, { x: confirmLine.indexOf("enter confirm") });
    await flush();
    expect(confirmed.result()).toEqual({ kind: "allow" });

    const aborted = mount({ command: "git commit -m hi" });
    const abortRow = aborted.rowOf("esc abort");
    const abortLine = aborted.render()[abortRow] ?? "";
    aborted.mouse("click", abortRow, { x: abortLine.indexOf("esc abort") });
    await flush();
    expect(aborted.result()).toEqual({ kind: "reject", abort: true });
  });

  it("opens a note from the tab hint", async () => {
    const h = mount({ command: "git commit -m hi" });
    const row = h.rowOf("tab add note");
    const line = h.render()[row] ?? "";

    h.mouse("click", row, { x: line.indexOf("tab add note") });
    h.type("w", "h", "y", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "allow", note: "why" });
  });

  it("leaves direction-only hints inert, since they name no single action", async () => {
    const h = mount({ command: "git commit -m hi" });
    const row = h.rowOf("↑↓ select");
    const line = h.render()[row] ?? "";

    expect(h.mouse("click", row, { x: line.indexOf("↑↓ select") })).toBeUndefined();
    await flush();
    expect(h.result()).toBeUndefined();
  });

  it("scrolls the detail window by the wheel's line count", () => {
    const h = mount({ command: longCommand });
    h.render(); // establish the window before scrolling

    expect(h.mouse("wheel", 6, { wheelDelta: 3 })).toEqual({ handled: true, render: true });
    const scrolled = h.render().join("\n");
    expect(scrolled).toContain("↑ 3");

    h.mouse("wheel", 6, { wheelDelta: -3 });
    const back = h.render().join("\n");
    expect(back).not.toMatch(/↑ \d+/);
  });

  it("reports no render when the wheel is already against a scroll stop", () => {
    const h = mount({ command: longCommand });
    h.render();

    expect(h.mouse("wheel", 6, { wheelDelta: -3 })).toEqual({ handled: true, render: false });
  });

  it("declines the wheel when the detail fits, leaving it to the transcript", () => {
    const h = mount({ command: "git commit -m hi" });
    h.render();

    expect(h.mouse("wheel", 6, { wheelDelta: 3 })).toBeUndefined();
  });

  it("edits an open note instead of authorizing when the click lands in it", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type(KEY.tab, "a", "b", "c", "d");
    const row = h.rowOf("1. Authorize");

    // Column 2 is the frame inset, so this is the note's own first column.
    h.mouse("click", row, { x: 2 + "  1. Authorize, and ".length + 2 });
    h.type("X", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "allow", note: "abXcd" });
  });
});

describe("permission prompt legend press feedback", () => {
  it.each([false, true])("highlights only the hint until release, edit=%s", async (edit) => {
    const h = mount({ command: "echo ok" });
    if (edit) h.type("2", KEY.enter);
    const hint = edit ? "esc back" : "esc abort";
    const row = h.rowOf(hint);
    const x = (h.render()[row] ?? "").indexOf(hint);

    expect(h.mouse("press", row, { x })).toEqual({ handled: true });
    expect(h.render()[row]).toContain(`\x1b[44m${hint}\x1b[49m`);
    expect(h.result()).toBeUndefined();
    expect(h.mouse("release", row, { x })).toEqual({ handled: true, render: true });
    expect(h.render()[row]).not.toContain("\x1b[44m");
    h.mouse("click", row, { x });
    await flush();
    if (edit) expect(h.render().join("\n")).toContain("esc abort");
    else expect(h.result()).toEqual({ kind: "reject", abort: true });
  });

  it("clears the hint highlight when dragging away or pressing padding", () => {
    const h = mount();
    const row = h.rowOf("esc abort");
    const x = (h.render()[row] ?? "").indexOf("esc abort");
    h.mouse("press", row, { x });
    h.mouse("drag", row, { x: 0 });
    expect(h.render()[row]).not.toContain("\x1b[44m");
    h.mouse("release", row, { x: 0 });
    expect(h.result()).toBeUndefined();

    h.mouse("press", row, { x });
    expect(h.mouse("press", row, { x: 0 })).toBeUndefined();
    expect(h.render()[row]).not.toContain("\x1b[44m");
    expect(h.mouse("click", row, { x: 0 })).toBeUndefined();
  });
});

// Pi retargets a release using the origin it captured at press, so the click
// arrives carrying the row number the press had, whatever the component has
// re-rendered into that row since. Reusing the press row is what makes these
// tests faithful rather than a convenience.
describe("permission prompt mouse gesture identity", () => {
  function withReflowingDetail() {
    const h = mount({ command: "echo original" });
    h.type("2");
    h.type(..." && echo a-very-long-tail-that-wraps-onto-a-second-line".split(""));
    h.type(KEY.escape, KEY.up);
    h.render();
    return h;
  }

  it("acts on the option that was pressed, not the one that reflowed under it", async () => {
    const h = withReflowingDetail();
    const editRow = h.rowOf("2. Edit");
    expect(h.render()[h.rowOf("1. Authorize")]).toContain("→ 1. Authorize");

    h.mouse("press", editRow);
    // Selecting Edit swaps the detail box to the taller edit buffer, pushing
    // every option down a row.
    expect(h.render()[editRow]).toContain("1. Authorize");

    h.mouse("click", editRow);
    await flush();

    expect(h.result()).toBeUndefined();
    expect(h.render().join("\n")).toContain("Note to agent");
  });

  it("does not let a reflowed row reach the legend beneath it", async () => {
    const h = withReflowingDetail();
    const abortRow = h.rowOf("3. Abort");

    h.mouse("press", abortRow);
    h.mouse("click", abortRow);
    await flush();

    expect(h.result()).toEqual({ kind: "reject", abort: true });
  });

  it("forgets a gesture abandoned by dragging off the option", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.mouse("press", h.rowOf("3. Abort"));

    // No click follows, because the pointer moved. The next click is a fresh
    // one on the legend, and must not inherit the abandoned choice: it opens a
    // note rather than committing the abort the press had selected.
    const row = h.rowOf("tab add note");
    const line = h.render()[row] ?? "";
    h.mouse("press", row);
    h.mouse("click", row, { x: line.indexOf("tab add note") });
    await flush();
    expect(h.result()).toBeUndefined();

    h.type("n", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "reject", abort: false, note: "n" });
  });
});

describe("permission prompt mouse in edit mode", () => {
  const enterEditMode = () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2");
    h.render();
    return h;
  };

  it("places the command cursor where the click landed", async () => {
    const h = enterEditMode();

    // The editor paints its text flush with the frame inset, so this is the
    // cell immediately after "git".
    h.mouse("click", h.rowOf("git commit -m hi"), { x: 2 + "git".length });
    h.type("X", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "edit", command: "gitX commit -m hi" });
  });

  it("moves focus to the note field and back by clicking each one", async () => {
    const h = enterEditMode();

    h.mouse("click", h.rowOf("Note to agent") + 1);
    h.type("n", "o", "t", "e");

    h.mouse("click", h.rowOf("git commit -m hi"), { x: 2 + "git commit -m hi".length });
    h.type("!", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "edit", command: "git commit -m hi!", note: "note" });
  });

  it("focuses a field from its label without moving the cursor", async () => {
    const h = enterEditMode();
    h.type("X"); // cursor sits after the command's last character

    h.mouse("click", h.rowOf("Note to agent"));
    h.type("n");
    h.mouse("click", h.rowOf("Command"));
    h.type("Y", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "edit", command: "git commit -m hiXY", note: "n" });
  });

  it("hands the embedded editor its focus back when the command is clicked", () => {
    const h = enterEditMode();

    h.type(KEY.tab); // focus the note by keyboard
    h.mouse("click", h.rowOf("git commit -m hi"), { x: 2 });

    // Pi positions the hardware cursor and the IME window from the marker the
    // Editor paints only while focused.
    expect(h.render().join("")).toContain(CURSOR_MARKER);
  });

  it("takes the marker off the editor when the note is clicked", () => {
    const h = enterEditMode();

    h.mouse("click", h.rowOf("Note to agent") + 1);

    expect(h.render()[h.rowOf("git commit -m hi")] ?? "").not.toContain(CURSOR_MARKER);
  });

  it("leaves presses and drags alone so text selection still works", () => {
    const h = enterEditMode();

    expect(h.mouse("press", h.rowOf("git commit -m hi"))).toBeUndefined();
    expect(h.mouse("drag", h.rowOf("git commit -m hi"))).toBeUndefined();
  });

  it("runs an edit-legend hint that is clicked", async () => {
    const h = enterEditMode();
    h.type("X");

    h.mouse("click", h.rowOf("enter run"), { x: 2 });
    await flush();

    expect(h.result()).toEqual({ kind: "edit", command: "git commit -m hiX" });
  });

  it("switches fields from the tab hint", async () => {
    const h = enterEditMode();
    const line = h.render()[h.rowOf("switch to note")] ?? "";

    h.mouse("click", h.rowOf("switch to note"), { x: line.indexOf("tab switch") });
    h.type("n", "o", "t", "e", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "allow", note: "note" });
  });

  it("ignores clicks on the gap between legend hints", async () => {
    const h = enterEditMode();
    const row = h.rowOf("enter run");
    const line = h.render()[row] ?? "";

    // The two spaces joining "enter run" to the hint after it.
    expect(h.mouse("click", row, { x: line.indexOf("enter run") + "enter run".length })).toBe(
      undefined,
    );
    await flush();
    expect(h.result()).toBeUndefined();
  });
});

describe("permission prompt don't ask again", () => {
  it("allows for the session from select mode", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type(KEY.ctrlS);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", forSession: true });
  });

  it("carries the Authorize note drafted before returning to select mode", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type(KEY.tab, "w", "h", "y", KEY.shiftTab, KEY.ctrlS);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", forSession: true, note: "why" });
  });

  it("commits mid-note without waiting for the note to be closed", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type(KEY.tab, "w", "h", "y", KEY.ctrlS);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", forSession: true, note: "why" });
  });

  it("uses the Authorize note while a note on another choice is being edited", async () => {
    const h = mount({ command: "git commit -m hi" });
    // note on Authorize, then a competing note on Abort; only the first travels
    h.type(KEY.tab, "y", "e", "s", KEY.shiftTab);
    h.type(KEY.down, KEY.down, KEY.tab, "n", "o", KEY.ctrlS);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", forSession: true, note: "yes" });
  });

  it("ignores ctrl+s once inside edit mode", async () => {
    const h = mount({ command: "git commit -m hi" });
    h.type("2", KEY.ctrlS);
    await flush();
    expect(h.result()).toBeUndefined();
  });

  it("advertises the outcome on a two-line select legend", () => {
    const h = mount({ command: "git commit -m hi" });
    const lines = h.render();
    const legendStart = lines.findIndex((line) => line.includes("↑↓"));

    expect(lines[legendStart]).toContain("ctrl+s don't ask again");
    expect(lines[legendStart]).toContain("enter confirm");
    expect(lines[legendStart + 1]).toContain("tab add note");
    expect(lines[legendStart + 1]).toContain("shift+tab close");
    expect(lines[legendStart + 1]).toContain("esc abort");
  });
});
