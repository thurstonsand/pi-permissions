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
