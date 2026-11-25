import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import type { PermissionHighlight } from "../src/highlight.js";
import { type PermissionGateResult, showPermissionGate } from "../src/ui/permission-prompt.js";

const KEY = {
  enter: "\r",
  escape: "\x1b",
  tab: "\t",
  shiftTab: "\x1b[Z",
  up: "\x1b[A",
  down: "\x1b[B",
  ctrlS: "\x13",
} as const;

const LABELS = { approveLabel: "Authorize", rejectLabel: "Abort" };

type Overlay = {
  handleInput(data: string): void;
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined;
  render(width: number): string[];
  focused: boolean;
};

type Harness = {
  overlay: Overlay;
  result(): PermissionGateResult | undefined;
  settled(): boolean;
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
  opts: { detail?: string; highlight?: PermissionHighlight; retract?: AbortSignal } = {},
): Harness {
  let overlay: Overlay | undefined;
  let result: PermissionGateResult | undefined;
  let settled = false;

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
          overlay = factory(tui, theme, undefined, resolve as (value: T) => void);
          overlay.focused = true;
        });
      },
    },
  } as unknown as ExtensionContext;

  void showPermissionGate(
    ctx,
    {
      name: "Authorization required: Git",
      header: "message",
      toolName: "bash",
      detail: opts.detail ?? "git commit -m hi",
      labels: LABELS,
      ...(opts.highlight !== undefined ? { highlight: opts.highlight } : {}),
    },
    opts.retract ?? new AbortController().signal,
  ).then((value) => {
    result = value;
    settled = true;
  });

  if (!overlay) throw new Error("overlay not mounted");

  return {
    overlay,
    result: () => result,
    settled: () => settled,
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

describe("permission prompt", () => {
  it("keeps j/k navigating onto a choice that carries a note draft", async () => {
    const h = mount();
    // put a note on Abort, close it, move back to Authorize
    h.type(KEY.down, KEY.tab, "n", "o", "t", "e", KEY.shiftTab, KEY.up);
    // j moves onto Abort (which carries the note); k must move back off rather
    // than type into the note
    h.type("j", "k", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "allow" });
  });

  it("emphasizes the highlighted fragment of the detail", () => {
    const h = mount({ detail: "git stash lst", highlight: /stash \w+/ });
    expect(h.render().join("\n")).toContain("git [[stash lst]]");
  });

  it("frames the detail in an inner box labeled with the tool name", () => {
    const h = mount();
    const lines = h.render();
    const top = lines.findIndex((line) => line.includes("╭─ bash "));
    const bottom = lines.findIndex((line) => line.includes("╰"));

    expect(top).toBeGreaterThan(-1);
    expect(bottom).toBeGreaterThan(top);
    expect(lines.slice(top + 1, bottom).join("\n")).toContain("git commit -m hi");
  });

  it("aborts from the second number key", async () => {
    const h = mount();
    h.type("2");
    await flush();
    expect(h.result()).toEqual({ kind: "reject", abort: true });
  });
});

describe("permission prompt body scrolling", () => {
  const longCommand = `git commit -m "${"word ".repeat(400)}TAIL_MARKER"`;

  it("windows a tall body so the options and legend stay on screen", () => {
    const h = mount({ detail: longCommand });
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
    const h = mount({ detail: longCommand });
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
    const h = mount();
    h.render();
    h.type("f", "b");
    const text = h.render().join("\n");
    expect(text).not.toContain("f/b scroll");
    expect(text).not.toContain("more");
    expect(h.result()).toBeUndefined();
  });

  it("still types f and b into an open note draft", async () => {
    const h = mount({ detail: longCommand });
    h.render();
    h.type(KEY.tab, "f", "b", KEY.enter);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", note: "fb" });
  });
});

describe("permission prompt mouse", () => {
  const longCommand = `git commit -m "${"word ".repeat(400)}TAIL_MARKER"`;

  it("authorizes when an option is pressed and released", async () => {
    const h = mount();
    const row = h.rowOf("1. Authorize");

    h.mouse("press", row);
    h.mouse("click", row);
    await flush();

    expect(h.result()).toEqual({ kind: "allow" });
  });

  it("aborts on a click on the second option", async () => {
    const h = mount();
    const row = h.rowOf("2. Abort");

    h.mouse("press", row);
    h.mouse("click", row);
    await flush();

    expect(h.result()).toEqual({ kind: "reject", abort: true });
  });

  it("moves the highlight on press without deciding anything", () => {
    const h = mount();

    const result = h.mouse("press", h.rowOf("2. Abort"));

    expect(result).toEqual({ handled: true, focus: true, render: true });
    expect(h.render().join("\n")).toContain("→ 2. Abort");
    expect(h.result()).toBeUndefined();
  });

  it("leaves hover alone so the pointer cannot arm the enter key", () => {
    const h = mount();

    expect(h.mouse("move", h.rowOf("2. Abort"))).toBeUndefined();
    expect(h.render().join("\n")).toContain("→ 1. Authorize");
  });

  it("ignores clicks that land outside the option rows", async () => {
    const h = mount();

    expect(h.mouse("click", h.rowOf("↑↓ select"))).toBeUndefined();
    await flush();
    expect(h.result()).toBeUndefined();
  });

  it("declines a click on the frame padding right of an option", async () => {
    const h = mount();
    const row = h.rowOf("1. Authorize");

    expect(h.mouse("press", row, { x: 2 + "  1. Authorize".length })).toBeUndefined();
    expect(h.mouse("click", row, { x: 40 })).toBeUndefined();
    await flush();

    expect(h.result()).toBeUndefined();
  });

  it("still takes a click past the end of an open note, as a text field would", async () => {
    const h = mount();
    h.type(KEY.tab, "a", "b");
    const row = h.rowOf("1. Authorize");

    h.mouse("click", row, { x: 50 });
    h.type("c", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "allow", note: "abc" });
  });

  it("confirms from the enter hint and aborts from the esc hint", async () => {
    const confirmed = mount();
    const confirmRow = confirmed.rowOf("enter confirm");
    const confirmLine = confirmed.render()[confirmRow] ?? "";
    confirmed.mouse("click", confirmRow, { x: confirmLine.indexOf("enter confirm") });
    await flush();
    expect(confirmed.result()).toEqual({ kind: "allow" });

    const aborted = mount();
    const abortRow = aborted.rowOf("esc abort");
    const abortLine = aborted.render()[abortRow] ?? "";
    aborted.mouse("click", abortRow, { x: abortLine.indexOf("esc abort") });
    await flush();
    expect(aborted.result()).toEqual({ kind: "reject", abort: true });
  });

  it("opens a note from the tab hint", async () => {
    const h = mount();
    const row = h.rowOf("tab add note");
    const line = h.render()[row] ?? "";

    h.mouse("click", row, { x: line.indexOf("tab add note") });
    h.type("w", "h", "y", KEY.enter);
    await flush();

    expect(h.result()).toEqual({ kind: "allow", note: "why" });
  });

  it("leaves direction-only hints inert, since they name no single action", async () => {
    const h = mount();
    const row = h.rowOf("↑↓ select");
    const line = h.render()[row] ?? "";

    expect(h.mouse("click", row, { x: line.indexOf("↑↓ select") })).toBeUndefined();
    await flush();
    expect(h.result()).toBeUndefined();
  });

  it("scrolls the detail window by the wheel's line count", () => {
    const h = mount({ detail: longCommand });
    h.render(); // establish the window before scrolling

    expect(h.mouse("wheel", 6, { wheelDelta: 3 })).toEqual({ handled: true, render: true });
    const scrolled = h.render().join("\n");
    expect(scrolled).toContain("↑ 3");

    h.mouse("wheel", 6, { wheelDelta: -3 });
    const back = h.render().join("\n");
    expect(back).not.toMatch(/↑ \d+/);
  });

  it("reports no render when the wheel is already against a scroll stop", () => {
    const h = mount({ detail: longCommand });
    h.render();

    expect(h.mouse("wheel", 6, { wheelDelta: -3 })).toEqual({ handled: true, render: false });
  });

  it("declines the wheel when the detail fits, leaving it to the transcript", () => {
    const h = mount();
    h.render();

    expect(h.mouse("wheel", 6, { wheelDelta: 3 })).toBeUndefined();
  });

  it("edits an open note instead of authorizing when the click lands in it", async () => {
    const h = mount();
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
  it("highlights only the hint until release", async () => {
    const h = mount();
    const hint = "esc abort";
    const row = h.rowOf(hint);
    const x = (h.render()[row] ?? "").indexOf(hint);

    expect(h.mouse("press", row, { x })).toEqual({ handled: true });
    expect(h.render()[row]).toContain(`\x1b[44m${hint}\x1b[49m`);
    expect(h.result()).toBeUndefined();
    expect(h.mouse("release", row, { x })).toEqual({ handled: true, render: true });
    expect(h.render()[row]).not.toContain("\x1b[44m");
    h.mouse("click", row, { x });
    await flush();
    expect(h.result()).toEqual({ kind: "reject", abort: true });
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
  it("acts on the option that was pressed, not what reflowed under it", async () => {
    const h = mount();
    h.type(KEY.tab, ..."a note long enough to wrap onto a second line of the prompt".split(""));
    const abortRow = h.rowOf("2. Abort");

    h.mouse("press", abortRow);
    // Selecting Abort closes the wrapped note on Authorize, pulling Abort up a row.
    expect(h.render()[abortRow]).not.toContain("2. Abort");

    h.mouse("click", abortRow);
    await flush();

    expect(h.result()).toEqual({ kind: "reject", abort: true });
  });

  it("forgets a gesture abandoned by dragging off the option", async () => {
    const h = mount();
    h.mouse("press", h.rowOf("2. Abort"));

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

describe("permission prompt don't ask again", () => {
  it("allows for the session from select mode", async () => {
    const h = mount();
    h.type(KEY.ctrlS);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", forSession: true });
  });

  it("carries the Authorize note drafted before returning to select mode", async () => {
    const h = mount();
    h.type(KEY.tab, "w", "h", "y", KEY.shiftTab, KEY.ctrlS);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", forSession: true, note: "why" });
  });

  it("commits mid-note without waiting for the note to be closed", async () => {
    const h = mount();
    h.type(KEY.tab, "w", "h", "y", KEY.ctrlS);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", forSession: true, note: "why" });
  });

  it("uses the Authorize note while a note on another choice is being edited", async () => {
    const h = mount();
    // note on Authorize, then a competing note on Abort; only the first travels
    h.type(KEY.tab, "y", "e", "s", KEY.shiftTab);
    h.type(KEY.down, KEY.tab, "n", "o", KEY.ctrlS);
    await flush();
    expect(h.result()).toEqual({ kind: "allow", forSession: true, note: "yes" });
  });

  it("advertises the outcome on a two-line select legend", () => {
    const h = mount();
    const lines = h.render();
    const legendStart = lines.findIndex((line) => line.includes("↑↓"));

    expect(lines[legendStart]).toContain("ctrl+s don't ask again");
    expect(lines[legendStart]).toContain("enter confirm");
    expect(lines[legendStart + 1]).toContain("tab add note");
    expect(lines[legendStart + 1]).toContain("shift+tab close");
    expect(lines[legendStart + 1]).toContain("esc abort");
  });
});

describe("permission prompt retraction", () => {
  it("closes without an answer once retracted", async () => {
    const retract = new AbortController();
    const h = mount({ retract: retract.signal });

    retract.abort();
    await flush();

    expect(h.settled()).toBe(true);
    expect(h.result()).toBeUndefined();
  });
});
