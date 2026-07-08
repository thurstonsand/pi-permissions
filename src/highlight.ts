export interface HighlightSpan {
  start: number;
  end: number;
}

export type PermissionHighlight =
  | string
  | RegExp
  | readonly (string | RegExp)[]
  | readonly HighlightSpan[]
  | ((detail: string) => readonly HighlightSpan[]);

export function highlightSpans(detail: string, highlight: PermissionHighlight): HighlightSpan[] {
  if (typeof highlight === "function") {
    try {
      return normalizeHighlightSpans(highlight(detail), detail.length);
    } catch {
      return [];
    }
  }

  const items: readonly unknown[] = Array.isArray(highlight) ? highlight : [highlight];
  if (isSpanArray(items)) return normalizeHighlightSpans(items, detail.length);
  if (!isPatternArray(items)) return [];

  return normalizeHighlightSpans(
    items.flatMap((pattern) => patternSpans(detail, pattern)),
    detail.length,
  );
}

function isSpanArray(items: readonly unknown[]): items is readonly HighlightSpan[] {
  return items.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "start" in item &&
      "end" in item &&
      typeof item.start === "number" &&
      typeof item.end === "number",
  );
}

function isPatternArray(items: readonly unknown[]): items is readonly (string | RegExp)[] {
  return items.every((item) => typeof item === "string" || item instanceof RegExp);
}

function patternSpans(detail: string, pattern: string | RegExp): HighlightSpan[] {
  return typeof pattern === "string" ? literalSpans(detail, pattern) : regexpSpans(detail, pattern);
}

function literalSpans(detail: string, pattern: string): HighlightSpan[] {
  if (!pattern) return [];

  const spans: HighlightSpan[] = [];
  let fromIndex = 0;

  while (fromIndex <= detail.length) {
    const start = detail.indexOf(pattern, fromIndex);
    if (start === -1) break;

    spans.push({ start, end: start + pattern.length });
    fromIndex = start + pattern.length;
  }

  return spans;
}

function regexpSpans(detail: string, pattern: RegExp): HighlightSpan[] {
  const globalPattern = new RegExp(pattern.source, globalFlags(pattern));
  const spans: HighlightSpan[] = [];

  while (true) {
    const match = globalPattern.exec(detail);
    if (!match) break;

    const matched = match[0];
    if (matched.length > 0) {
      spans.push({ start: match.index, end: match.index + matched.length });
      continue;
    }

    globalPattern.lastIndex += 1;
    if (globalPattern.lastIndex > detail.length) break;
  }

  return spans;
}

function globalFlags(pattern: RegExp): string {
  return `${pattern.flags.replace(/[gy]/g, "")}g`;
}

function normalizeHighlightSpans(
  spans: readonly HighlightSpan[],
  detailLength: number,
): HighlightSpan[] {
  const normalized = spans.flatMap((span) => {
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end)) return [];
    if (span.start >= span.end) return [];

    const start = clampOffset(span.start, detailLength);
    const end = clampOffset(span.end, detailLength);
    return start < end ? [{ start, end }] : [];
  });

  normalized.sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: HighlightSpan[] = [];
  for (const span of normalized) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

function clampOffset(offset: number, detailLength: number): number {
  return Math.max(0, Math.min(detailLength, Math.trunc(offset)));
}
