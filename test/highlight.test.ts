import { describe, expect, it } from "vitest";
import { highlightSpans } from "../src/highlight.js";

describe("highlightSpans", () => {
  it("finds non-overlapping literal and regexp occurrences", () => {
    expect(highlightSpans("foo foo", "foo")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
    expect(highlightSpans("ababa", "aba")).toEqual([{ start: 0, end: 3 }]);
    expect(highlightSpans("ababa", /aba/)).toEqual([{ start: 0, end: 3 }]);
  });

  it("finds every regexp occurrence regardless of the global flag", () => {
    expect(highlightSpans("git add && git commit", /git (add|commit)\b/)).toEqual([
      { start: 0, end: 7 },
      { start: 11, end: 21 },
    ]);
  });

  it("respects regexp flags supplied by the author", () => {
    expect(highlightSpans("Git ADD && git add", /git add/i)).toEqual([
      { start: 0, end: 7 },
      { start: 11, end: 18 },
    ]);
  });

  it("merges adjacent and overlapping spans from multiple patterns", () => {
    expect(highlightSpans("abcdef", ["abc", /cde/, "f"])).toEqual([{ start: 0, end: 6 }]);
  });

  it("uses callback spans as the escape hatch", () => {
    expect(
      highlightSpans("npm test && git add -A", (detail) => [
        { start: detail.indexOf("git"), end: detail.length + 100 },
        { start: 4, end: 4 },
        { start: 8, end: 2 },
      ]),
    ).toEqual([{ start: 12, end: 22 }]);
  });

  it("treats empty matches and throwing callbacks as no highlight", () => {
    expect(highlightSpans("abc", /(?:)/)).toEqual([]);
    expect(
      highlightSpans("abc", () => {
        throw new Error("bad hint");
      }),
    ).toEqual([]);
  });
});
