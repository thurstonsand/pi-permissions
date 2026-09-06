import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** A hint the legend advertises. Hints naming a direction rather than an action carry no `run`. */
export type LegendItem = { key: string; description: string; run?: () => void };

export type LegendHit = { start: number; end: number; run: () => void };

/** A laid-out legend line: what to draw, and which columns answer to a click. */
export type LegendLine = { text: string; hits: LegendHit[] };

const SEPARATOR = "  ";

/**
 * A legend that advertises an action should perform it, which means rendering
 * and hit-testing have to agree on where each hint sits. Laying both out in one
 * pass is what keeps them agreeing.
 *
 * `trailing` is right-aligned in the remaining space. Under a `width`, the line
 * is truncated and any hint the ellipsis ate is dropped rather than left as an
 * invisible target.
 */
export function layoutLegend(
  theme: Theme,
  items: LegendItem[],
  options: { width?: number; trailing?: string } = {},
): LegendLine {
  const parts: string[] = [];
  const hits: LegendHit[] = [];
  let column = 0;

  for (const item of items) {
    if (parts.length > 0) {
      parts.push(SEPARATOR);
      column += SEPARATOR.length;
    }
    const end = column + visibleWidth(item.key) + 1 + visibleWidth(item.description);
    if (item.run && (options.width === undefined || end <= options.width)) {
      hits.push({ start: column, end, run: item.run });
    }
    parts.push(theme.fg("dim", item.key) + theme.fg("muted", ` ${item.description}`));
    column = end;
  }

  const left = parts.join("");
  if (options.width === undefined) return { text: left, hits };

  const trailing = options.trailing ? theme.fg("dim", options.trailing) : "";
  const gap = Math.max(1, options.width - column - visibleWidth(trailing));
  return {
    text: truncateToWidth(`${left}${" ".repeat(gap)}${trailing}`, options.width, "…", true),
    hits,
  };
}

/** The hint occupying `column`, if any. Gaps between hints answer to nothing. */
export function legendHitAt(hits: LegendHit[], column: number): LegendHit | undefined {
  return hits.find((hit) => column >= hit.start && column < hit.end);
}
