// Small windows: below the full layout's breakpoint the app shows a mini player instead, and below the mini player's
// own minimum just a "too small" notice. Sizes are CSS pixels (window.innerWidth/innerHeight), so the zoom setting
// moves the breakpoints with everything else.

/** The smallest window the full layout (sidebar rail, top bar, page, player bar) is shown in. */
export const FULL_MIN = { width: 480, height: 400 };
/** The smallest window the mini player fits in; below it the window says it's too small. */
export const COMPACT_MIN = { width: 220, height: 150 };
/** The mini player's column shape (big cover above the controls) needs this much height. */
export const COLUMN_MIN_HEIGHT = 300;
/** The mini player's row shape (cover beside the controls) needs this much width. */
export const ROW_MIN_WIDTH = 400;
/** "Make the window bigger": at least this, never smaller than it already is. */
export const GROW_TO = { width: 960, height: 640 };

export type WindowMode = "full" | "compact" | "tiny";
/** column: big cover on top. row: cover on the left, controls beside it. stack: a small thumbnail by the title. */
export type CompactShape = "column" | "row" | "stack";

const known = (n: number) => Number.isFinite(n) && n > 0;

/** Which UI a window of this size gets. An unknown size (0 while hidden or minimized) keeps the full layout. */
export function windowMode(width: number, height: number): WindowMode {
  if (!known(width) || !known(height)) return "full";
  if (width < COMPACT_MIN.width || height < COMPACT_MIN.height) return "tiny";
  if (width < FULL_MIN.width || height < FULL_MIN.height) return "compact";
  return "full";
}

/** How the mini player arranges itself in a window of this size. */
export function compactShape(width: number, height: number): CompactShape {
  if (height >= COLUMN_MIN_HEIGHT) return "column";
  return width >= ROW_MIN_WIDTH ? "row" : "stack";
}

/**
 * The cover's side in the column shape: as wide as the window allows, leaving `reserved` px of height for the text
 * and controls under it, between 64 and 360 px.
 */
export function columnCoverSize(width: number, height: number, reserved: number): number {
  const fit = Math.min(width - 32, height - reserved);
  return Math.round(Math.min(360, Math.max(64, fit)));
}

/** The cover's side in the row shape: the height inside the padding, but at most a bit over a third of the width. */
export function rowCoverSize(width: number, height: number): number {
  return Math.round(Math.max(64, Math.min(240, height - 24, width * 0.36)));
}

/** The size "Make the window bigger" asks for: GROW_TO, or the current size where that is already bigger. */
export function grownSize(width: number, height: number): { width: number; height: number } {
  return { width: Math.max(GROW_TO.width, Math.round(width)), height: Math.max(GROW_TO.height, Math.round(height)) };
}
