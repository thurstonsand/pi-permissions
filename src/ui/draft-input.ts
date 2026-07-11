import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, getKeybindings, matchesKey, visibleWidth } from "@earendil-works/pi-tui";

type WrappedLine = {
  text: string;
  startIndex: number;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function sanitizeDraftInput(text: string): string {
  return text
    .replaceAll("\x1b[200~", "")
    .replaceAll("\x1b[201~", "")
    .replace(/[\r\n]+/g, " ");
}

// A single-line, grapheme-aware text field. Owns its own buffer and cursor so
// the several places that collect approver notes (each select-mode choice, plus
// the edit-mode note field) are distinct instances rather than one buffer shared
// through a moving index.
export class DraftInput {
  text = "";
  cursor = 0;

  constructor(private theme: Theme) {}

  get trimmed(): string {
    return this.text.trim();
  }

  toEnd(): void {
    this.cursor = this.text.length;
  }

  setText(text: string): void {
    this.text = text;
    this.toEnd();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "left")) {
      if (this.cursor > 0) this.cursor -= getPreviousGraphemeLength(this.text, this.cursor);
      return;
    }

    if (matchesKey(data, "right")) {
      if (this.cursor < this.text.length) {
        this.cursor += getNextGraphemeLength(this.text, this.cursor);
      }
      return;
    }

    if (matchesKey(data, "home") || getKeybindings().matches(data, "tui.editor.cursorLineStart")) {
      this.cursor = 0;
      return;
    }

    if (matchesKey(data, "end") || getKeybindings().matches(data, "tui.editor.cursorLineEnd")) {
      this.cursor = this.text.length;
      return;
    }

    if (getKeybindings().matches(data, "tui.editor.cursorWordLeft")) {
      this.cursor = wordBoundaryLeft(this.text, this.cursor);
      return;
    }

    if (getKeybindings().matches(data, "tui.editor.cursorWordRight")) {
      this.cursor = wordBoundaryRight(this.text, this.cursor);
      return;
    }

    if (this.deleteWordBackward(data)) return;
    if (this.deleteWordForward(data)) return;
    if (this.deleteBackward(data)) return;
    if (this.deleteForward(data)) return;

    const text = sanitizeDraftInput(data);
    if (!text || hasControlCharacters(text)) return;

    this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
    this.cursor += text.length;
  }

  renderLines(
    width: number,
    opts: { color: ThemeColor; showCursor: boolean; focused: boolean; firstPrefix?: string },
  ): string[] {
    const firstPrefix = opts.firstPrefix ?? "";
    const prefixWidth = visibleWidth(firstPrefix);
    const paint = (fragment: string) => this.theme.fg(opts.color, fragment);
    const rawDisplay =
      this.text.length > 0 && this.cursor < this.text.length ? this.text : `${this.text} `;
    const wrapped = wrapDraftText(rawDisplay, width - prefixWidth);

    return wrapped.map((line, lineIndex) => {
      const rowPrefix = lineIndex === 0 ? firstPrefix : " ".repeat(prefixWidth);
      const lineStart = line.startIndex;
      const lineEnd = line.startIndex + line.text.length;
      const hasCursor = opts.showCursor && this.cursor >= lineStart && this.cursor < lineEnd;

      if (!hasCursor) return paint(rowPrefix + line.text);

      const cursorLength = getNextGraphemeLength(rawDisplay, this.cursor);
      const localIndex = this.cursor - lineStart;
      const before = line.text.slice(0, localIndex);
      const cursorText = line.text.slice(localIndex, localIndex + cursorLength) || " ";
      const after = line.text.slice(localIndex + cursorLength);

      return (
        paint(rowPrefix + before) +
        (opts.focused ? CURSOR_MARKER : "") +
        this.theme.inverse(cursorText) +
        paint(after)
      );
    });
  }

  private deleteWordBackward(data: string): boolean {
    if (!getKeybindings().matches(data, "tui.editor.deleteWordBackward")) return false;

    const start = wordBoundaryLeft(this.text, this.cursor);
    this.text = this.text.slice(0, start) + this.text.slice(this.cursor);
    this.cursor = start;
    return true;
  }

  private deleteWordForward(data: string): boolean {
    if (!getKeybindings().matches(data, "tui.editor.deleteWordForward")) return false;

    const end = wordBoundaryRight(this.text, this.cursor);
    this.text = this.text.slice(0, this.cursor) + this.text.slice(end);
    return true;
  }

  private deleteBackward(data: string): boolean {
    if (
      !getKeybindings().matches(data, "tui.editor.deleteCharBackward") &&
      !matchesKey(data, "backspace")
    ) {
      return false;
    }

    if (this.cursor > 0) {
      const len = getPreviousGraphemeLength(this.text, this.cursor);
      this.text = this.text.slice(0, this.cursor - len) + this.text.slice(this.cursor);
      this.cursor -= len;
    }
    return true;
  }

  private deleteForward(data: string): boolean {
    if (
      !getKeybindings().matches(data, "tui.editor.deleteCharForward") &&
      !matchesKey(data, "delete")
    ) {
      return false;
    }

    if (this.cursor < this.text.length) {
      const len = getNextGraphemeLength(this.text, this.cursor);
      this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + len);
    }
    return true;
  }
}

function getNextGraphemeLength(text: string, index: number): number {
  const remaining = text.slice(index);
  const first = segmenter.segment(remaining)[Symbol.iterator]().next().value;
  return first?.segment.length ?? 1;
}

function getPreviousGraphemeLength(text: string, index: number): number {
  const before = text.slice(0, index);
  const parts = [...segmenter.segment(before)];
  return parts.at(-1)?.segment.length ?? 1;
}

function wordBoundaryLeft(text: string, cursor: number): number {
  let index = cursor;
  while (index > 0 && /\s/.test(text[index - 1] ?? "")) index--;
  while (index > 0 && !/\s/.test(text[index - 1] ?? "")) index--;
  return index;
}

function wordBoundaryRight(text: string, cursor: number): number {
  let index = cursor;
  while (index < text.length && /\s/.test(text[index] ?? "")) index++;
  while (index < text.length && !/\s/.test(text[index] ?? "")) index++;
  return index;
}

function hasControlCharacters(text: string): boolean {
  return [...text].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });
}

function wrapDraftText(text: string, width: number): WrappedLine[] {
  const maxWidth = Math.max(1, width);
  const lines: WrappedLine[] = [];
  let offset = 0;
  let remaining = text;

  while (remaining.length > 0) {
    if (visibleWidth(remaining) <= maxWidth) {
      lines.push({ text: remaining, startIndex: offset });
      break;
    }

    let currentWidth = 0;
    let breakIndex = -1;

    for (const part of segmenter.segment(remaining)) {
      const piece = part.segment;
      const pieceWidth = visibleWidth(piece);

      if (currentWidth + pieceWidth > maxWidth) {
        if (breakIndex !== -1) {
          lines.push({ text: remaining.slice(0, breakIndex).trimEnd(), startIndex: offset });
          const rest = remaining.slice(breakIndex).trimStart();
          offset += breakIndex;
          remaining = rest;
        } else {
          const line = remaining.slice(0, part.index) || piece;
          const consumed = remaining.slice(0, part.index) ? part.index : piece.length;
          lines.push({ text: line, startIndex: offset });
          offset += consumed;
          remaining = remaining.slice(consumed);
        }
        break;
      }

      currentWidth += pieceWidth;
      if (/\s/.test(piece)) {
        breakIndex = part.index + piece.length;
      }
    }
  }

  return lines.length > 0 ? lines : [{ text: "", startIndex: 0 }];
}
