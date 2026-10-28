/**
 * Gapless playback (Settings → Playback): the next song is loaded into a second, silent <audio> element ahead of
 * time, and when the current one ends that element simply starts and becomes the player (stores/player.ts swaps
 * the two), so there's no gap for resolving and buffering a stream. Pure decisions the player asks on its clock.
 */

/** The next song is prepared from this share of the current one on (or seeking there)... */
export const PREPARE_AT = 0.8;
/** ...but at least this long before the end, for short songs. */
export const PREPARE_LEAD_S = 20;
/** Within this much of the end the hand-over is timed precisely (timeupdate comes only every ~250 ms). */
export const HANDOVER_WINDOW_S = 1;
/**
 * The next song starts this much before the current one's last sample, since starting playback takes a moment (the
 * element's pipeline going from paused to playing). A first guess; the player learns the real time (`learnLead`).
 */
export const HANDOVER_LEAD_MS = 150;
export const MIN_LEAD_MS = 20;
export const MAX_LEAD_MS = 600;

export interface ClockInput {
  position: number;
  duration: number;
  /** Songs only: not a podcast episode, a live stream or "repeat one" (which restarts the same song). */
  eligible: boolean;
}

const known = (d: number) => d > 0 && Number.isFinite(d);

/** Whether the next song should be loading in the background now. */
export function shouldPrepare(i: ClockInput): boolean {
  if (!i.eligible || !known(i.duration)) return false;
  return i.position >= i.duration * PREPARE_AT || i.duration - i.position <= PREPARE_LEAD_S;
}

/**
 * Milliseconds until the next song should start (null: not near the end yet). `rate` is the playback rate, so the
 * remaining media time becomes wall time.
 */
export function handoverIn(i: ClockInput, rate = 1, leadMs = HANDOVER_LEAD_MS): number | null {
  if (!i.eligible || !known(i.duration)) return null;
  const left = i.duration - i.position;
  if (left > HANDOVER_WINDOW_S) return null;
  return Math.max(0, (left * 1000) / (rate || 1) - leadMs);
}

/** The next lead from a measured start (play() until it really plays), smoothed and bounded. */
export function learnLead(lead: number, measuredMs: number): number {
  return Math.min(MAX_LEAD_MS, Math.max(MIN_LEAD_MS, Math.round(lead * 0.5 + measuredMs * 0.5)));
}
