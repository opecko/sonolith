// Transparent window: while Now Playing slides, the app under it would show through its translucent background. The
// part of the app the overlay already covers is clipped away instead (pure; NowPlaying.tsx writes the clip-path).

/**
 * How many px to cut off the bottom of the content under the overlay, for the overlay's slide position `y` (% of
 * its height, 100 = hidden). `panel` is the overlay's untransformed box, `content` the app's.
 */
export function underInset(y: number, panel: { top: number; height: number }, content: { top: number; bottom: number }): number {
  const edge = panel.top + (Math.min(100, Math.max(0, y)) / 100) * panel.height;
  return Math.min(content.bottom - content.top, Math.max(0, content.bottom - edge));
}
