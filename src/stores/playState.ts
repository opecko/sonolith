/** What the store shows; "loading", "idle" and "error" are owned by the player's load / failure paths. */
export type PlayStatus = "idle" | "loading" | "playing" | "paused" | "error";

/** The parts of the <audio> element's state that decide playing vs paused. */
export interface ElementState {
  paused: boolean;
  ended: boolean;
}

/**
 * The status the element says it should be, or null when the store already agrees (or owns it: loading, idle,
 * error). The element is the truth: events can arrive late or out of order (WebKitGTK, around seeks and quick
 * pause/play), and a store that says "paused" over a playing element made pause and play dead ends.
 */
export function reconcileStatus(status: PlayStatus, el: ElementState): PlayStatus | null {
  if (status === "playing" && el.paused && !el.ended) return "paused";
  if (status === "paused" && !el.paused) return "playing";
  return null;
}

/** What a play/pause toggle does: decided by the element, never by a possibly stale status. */
export function toggleAction(status: PlayStatus, el: ElementState, hasTrack: boolean): "play" | "pause" | "restart" | null {
  if (status === "playing" || status === "paused") return el.paused ? "play" : "pause";
  // "error", or "idle" with a restored queue: (re)start the current track from the beginning.
  if ((status === "error" || status === "idle") && hasTrack) return "restart";
  return null;
}

/**
 * Time moving on an element that says it's paused: the media pipeline didn't stop (sound keeps playing with the
 * pause button dead). `moved` is how far currentTime got since the pause, in seconds.
 */
export const pipelineStuck = (el: ElementState, moved: number) => el.paused && !el.ended && moved > 1;
