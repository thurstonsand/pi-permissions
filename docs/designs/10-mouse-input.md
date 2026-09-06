# Mouse input at the prompt and the permissions modal

## Status

Accepted, implemented.

Builds on design 07 (edit command at prompt) and design 03 (per-hook permission enablement). Terminology per `CONTEXT.md`: Approver, Prompt, Edit, Note, Permission hook, Enabled.

## Decision Summary

Both TUI surfaces answer the mouse in Pi's fullscreen mode. Each keeps hit maps rebuilt during `render()`, and each carries the identity of what a press landed on for the length of the gesture, because Pi resolves a release against the coordinate frame captured at press while the component may have re-rendered into a different shape underneath it. Resolving a click by coordinates a second time is what turns a press on Edit into an approval.

## Problem Statement / Background

Pi 0.85.0 routes normalized pointer events to components in fullscreen TUI mode through `Component.handleMouse`. Neither surface implemented it, so the Approver could not click a choice, could not scroll a command taller than the screen with anything but `f`/`b`, and could not put the cursor where they were looking in the Edit view.

Both surfaces render themselves as flat arrays of padded lines rather than trees of child components. The prompt frames its content in a border and windows an unbounded, agent-authored command inside an inner box; the modal renders a list pane and a detail pane side by side on shared rows. Neither has a component whose bounds Pi could hit-test on its behalf.

## Goals

- Click a choice, a permission, or a legend hint to do what it advertises.
- Scroll the prompt's windowed detail and the modal's selection with the wheel.
- Place the cursor and move focus by clicking in the Edit view's two fields.
- Leave every keyboard path exactly as it was, including in Pi's non-fullscreen mode, where no pointer events arrive at all.

## Non-Goals

- Rebuilding either surface out of `Container`, `MouseRegion`, `SelectList`, or `ScrollView`. See Alternatives.
- Hover-to-highlight. See Design Decisions.
- Mouse support outside fullscreen mode. Pi does not capture the pointer there, because the terminal owns its own scrollback.

## Design Decisions

### A gesture carries its identity, not its coordinates

`TuiAltScreen` records the receiving component's origin at press and reuses it to build the release and the synthesized click (`retargetMouseEvent`). The local row therefore stays fixed across the gesture even when the component's origin has moved.

The prompt's height is not fixed. Selecting Edit swaps the detail box from the agent's original command to the Approver's edit buffer, which can be taller. The surface is anchored at the bottom of the screen, so growing pushes its top upward, the options hold their screen rows, and every local row now names the line above the one it named at press. The modal has the same property for a different reason: selecting the topmost hook makes `clampScroll` pull its origin label back into view, shifting the list down a row.

So a press records what it landed on, and the click consumes that record instead of asking the hit map again. Concretely, on an unfixed prompt: press `2. Edit`, release without moving, and the click resolves the stale row to `1. Authorize` and approves a command the Approver was trying to rewrite. This is Pi's own pattern; `SelectList` keeps `mousePressedIndex` for the same reason.

The record is assigned on every press, including presses that hit nothing, so a gesture abandoned by dragging away cannot leak its choice into a later click.

### Press and click are split by what the target is

Controls (choices, permissions, legend hints) act. Text (the command editor, an open note) places a cursor.

Controls answer `press` by selecting, so the Approver sees which one they are on and what it will do, and answer the synthesized `click` by committing. Text answers only `click`, leaving `press` unhandled, which is what lets the renderer's screen-level drag-selection run across it; this is the convention Pi's own `Editor.handleMouse` follows. An open note is text, not a button, even though it is drawn on an option's row: committing there would approve a command out from under someone reaching for a typo.

### No hover

`SelectList` moves its selection on pointer motion. This surface authorizes commands. A selection that follows the pointer puts whatever the mouse last grazed under the enter key, so motion is ignored.

### Click targets are the visible control, not the row

A row spans the full frame; the control on it usually does not. Option rows are clickable only across the option's own rendered width, hook rows only across the list pane's columns, and legend hints only across their own `key description` pair, with the gaps between hints inert. The one exception is an open note, where clicking past the end of a line puts the cursor at the end, as every text field does.

### Hit maps are built during render

Both surfaces record, while rendering, which rows carry what: `optionRows` and `legendRows` in the prompt, `hookRows`, `listCellEndX`, and `legendRow` in the modal. Render always precedes any pointer event that could consume them, and the alternative is a second layout pass that can disagree with the first. The legend takes this furthest: `layoutLegend` emits the drawn text and the clickable column ranges from one walk, so a hint cannot be drawn in one place and clicked in another.

## Edge Cases & Failure Modes

- **Reflow between press and release.** Covered above; the pressed identity wins.
- **Gesture abandoned mid-flight.** Pi sends no click when the pointer moved. The next press overwrites the record.
- **A click with no press of ours.** Reaches the legend, the note, or an Edit field, all resolved against a freshly delivered row. Nothing reflows on a press these paths did not claim.
- **Detail pane taller than the list.** Those extra rows belong to no hook and answer to nothing.
- **A legend truncated by the modal's width.** Hints the ellipsis ate are dropped rather than left as invisible targets.
- **Empty hook list.** The modal's legend still answers, because cancel is the only way out of that state.
- **Wrapped note text.** `wrapDraftText` consumes the whitespace it breaks on; its buffer offsets now account for it, or a click lands inside the swallowed run instead of on the character under the pointer.

## Alternatives

**Rebuild both surfaces from Pi's component primitives.** `Container` hit-tests its children by height and `SelectList` already implements click-to-select, so the row maps would go away. Rejected for now: it is a rewrite of two working surfaces, and it does not remove the need for gesture identity, since `SelectList` keeps `mousePressedIndex` for precisely the reason described above. The prompt's detail window is the strongest candidate on its own merits, since a `ScrollView` with `overscroll: "contain"` would bring a real scrollbar and drop the hand-rolled windowing; `f`/`b` would have to stay for non-fullscreen mode.

**Resolve the click by coordinates and re-render only after it.** Would fix the reflow by deferring the visible effect of a press, at the cost of the press no longer showing what it selected, and it would still be wrong for any re-render triggered from outside the gesture.

**One shared mouse mixin for both surfaces.** Their geometry has nothing in common beyond the frame inset. Only the legend was genuinely duplicated, and that is now `src/ui/legend.ts`.
