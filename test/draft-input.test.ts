import { describe, expect, it } from "vitest";
import { DraftInput } from "../src/ui/draft-input.js";

const theme = {
  fg: (_color: string, text: string) => text,
  inverse: (text: string) => text,
} as unknown as ConstructorParameters<typeof DraftInput>[0];

const KEY = {
  wordLeft: "\x1bb", // alt+b
  wordRight: "\x1bf", // alt+f
  deleteWordBackward: "\x17", // ctrl+w
  deleteWordForward: "\x1bd", // alt+d
} as const;

function draft(text: string): DraftInput {
  const input = new DraftInput(theme);
  input.setText(text); // cursor lands at the end
  return input;
}

describe("DraftInput word motion", () => {
  it("jumps the cursor left and right by word", () => {
    const input = draft("foo bar baz");
    expect(input.cursor).toBe(11);

    input.handleInput(KEY.wordLeft);
    expect(input.cursor).toBe(8); // before "baz"
    input.handleInput(KEY.wordLeft);
    expect(input.cursor).toBe(4); // before "bar"

    input.handleInput(KEY.wordRight);
    expect(input.cursor).toBe(7); // after "bar"
  });

  it("deletes a word backward from the cursor", () => {
    const input = draft("foo bar baz");
    input.handleInput(KEY.deleteWordBackward);
    expect(input.text).toBe("foo bar ");
    expect(input.cursor).toBe(8);
  });

  it("deletes a word forward from the cursor", () => {
    const input = draft("foo bar baz");
    input.handleInput(KEY.wordLeft); // cursor before "baz" (8)
    input.handleInput(KEY.wordLeft); // cursor before "bar" (4)
    input.handleInput(KEY.deleteWordForward);
    expect(input.text).toBe("foo  baz");
    expect(input.cursor).toBe(4);
  });
});

describe("DraftInput cursor placement from a click", () => {
  const render = (input: DraftInput, width: number, prefix?: string) =>
    input.renderLines(width, {
      color: "dim",
      showCursor: false,
      focused: false,
      ...(prefix ? { firstPrefix: prefix } : {}),
    });

  it("maps a click on a wrapped row past whitespace the wrap swallowed", () => {
    const input = draft("abc    def");
    expect(render(input, 5)).toEqual(["abc", "def "]);

    input.placeCursor(5, 1, 0);

    expect(input.cursor).toBe(7); // the "d", not the run of spaces before it
  });

  it("walks continuation rows without drifting", () => {
    const input = draft("one two three four");
    expect(render(input, 8)).toEqual(["one two", "three", "four "]);

    input.placeCursor(8, 1, 0);
    expect(input.cursor).toBe(8);
    input.placeCursor(8, 2, 0);
    expect(input.cursor).toBe(14);
  });

  it("measures columns past the first row's prefix", () => {
    const input = draft("hello world");
    const prefix = "> ";
    expect(render(input, 12, prefix)).toEqual(["> hello", "  world "]);

    input.placeCursor(12, 0, prefix.length + 2, prefix.length);

    expect(input.cursor).toBe(2);
  });

  it("lands on grapheme boundaries rather than inside a wide character", () => {
    const input = draft("aあb");

    input.placeCursor(10, 0, 2); // the second cell of the wide "あ"

    expect(input.cursor).toBe(1);
    input.handleInput("X");
    expect(input.text).toBe("aXあb");
  });

  it("clamps a click past the end of the text to the end of the buffer", () => {
    const input = draft("hi");

    input.placeCursor(20, 0, 15);

    expect(input.cursor).toBe(2);
  });
});
