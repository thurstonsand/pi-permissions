import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

/** A hint the legend advertises. Hints naming a direction rather than an action carry no `run`. */
export type LegendItem = { key: string; description: string; run?: () => void };

export type LegendHit = { key: string; start: number; end: number; run: () => void };

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
  options: { width?: number; trailing?: string; pressedKey?: string | undefined } = {},
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
    const run = options.width === undefined || end <= options.width ? item.run : undefined;
    if (run) {
      hits.push({ key: item.key, start: column, end, run });
    }
    const text = theme.fg("dim", item.key) + theme.fg("muted", ` ${item.description}`);
    parts.push(run && item.key === options.pressedKey ? theme.bg("selectedBg", text) : text);
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

export class LegendPointer {
  private pressed: LegendHit | undefined;
  private down = false;

  constructor(private readonly requestRender: () => void) {}

  get pressedKey(): string | undefined {
    return this.down ? this.pressed?.key : undefined;
  }

  handleMouse(event: TuiMouseEvent, hit: LegendHit | undefined): TuiMouseEventResult | undefined {
    if (event.type === "press") {
      const wasDown = this.down;
      this.pressed = event.button === "left" ? hit : undefined;
      this.down = this.pressed !== undefined;
      if (this.down) return { handled: true };
      if (wasDown) this.requestRender();
      return undefined;
    }
    if (event.button !== "left") return undefined;
    if (event.type === "drag" && this.pressed) {
      this.pressed = undefined;
      this.down = false;
      return { handled: true };
    }
    if (event.type === "release" && this.pressed) {
      this.down = false;
      return { handled: true, render: true };
    }
    if (event.type === "click") {
      // Pi reuses the press-time coordinate frame after a re-render. Keep the
      // pressed action rather than resolving that old frame against new hints.
      const action = this.pressed ?? hit;
      this.pressed = undefined;
      this.down = false;
      if (!action) return undefined;
      action.run();
      return { handled: true };
    }
    return undefined;
  }
}

/** The hint occupying `column`, if any. Gaps between hints answer to nothing. */
export function legendHitAt(hits: LegendHit[], column: number): LegendHit | undefined {
  return hits.find((hit) => column >= hit.start && column < hit.end);
}
