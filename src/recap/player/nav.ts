// The story player's navigation rules, pure so they're tested without a browser.

export type NavAction = "close" | "next" | "prev" | "pause" | "end";

/** What a key does inside the recap (null: not ours, the key goes on to the focused control). */
export function keyAction(key: string, ctx: { game: boolean; inControl: boolean }): NavAction | null {
  if (key === "Escape") return "close";
  if (key === "ArrowRight") return ctx.game ? null : "next";
  if (key === "ArrowLeft") return "prev";
  if (key === " " && !ctx.inControl) return "pause";
  return null;
}

/** A click on the card: the left 30 % goes back, the rest forward; games take their own clicks. */
export function clickAction(xFraction: number, game: boolean): NavAction | null {
  if (game) return null;
  return xFraction < 0.3 ? "prev" : "next";
}

/** The card index after an action. */
export function step(index: number, n: number, action: NavAction): number {
  if (action === "next") return Math.min(n - 1, index + 1);
  if (action === "prev") return Math.max(0, index - 1);
  if (action === "end") return n - 1;
  return index;
}

/** Whether the timer moves the story on by itself right now. */
export function autoAdvancing(s: { autoAdvance: boolean; paused: boolean; held: boolean; hidden: boolean; game: boolean; last: boolean; duration: number }): boolean {
  return s.autoAdvance && !s.paused && !s.held && !s.hidden && !s.game && !s.last && s.duration > 0;
}
