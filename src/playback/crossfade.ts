/**
 * Crossfade between songs (Settings → Playback), as pure decisions the player asks on its clock. The next song is
 * loaded into a second, silent <audio> element ahead of time, so the fade starts on a song that's ready; during the
 * fade both elements play, the old one fading out, the new one in, and the new one is the player from its first
 * moment (stores/player.ts swaps the elements).
 */

/** Crossfade lengths offered in Settings (seconds; 0 = off). */
export const CROSSFADE_MAX_S = 12;

/** The next song is prepared from this share of the current one on (or seeking there)... */
export const PREPARE_AT = 0.8;
/** ...but at least this long before its fade starts, for short songs. */
export const PREPARE_LEAD_S = 20;

export interface ClockInput {
  /** Crossfade setting, seconds (0: off). */
  crossfade: number;
  position: number;
  duration: number;
  /** Songs only: not a podcast episode, a live stream or "repeat one" (which restarts the same song). */
  eligible: boolean;
}

/** Whether the next song should be loading in the background now. */
export function shouldPrepare(i: ClockInput): boolean {
  if (!i.eligible || i.crossfade <= 0 || !(i.duration > 0) || !Number.isFinite(i.duration)) return false;
  return i.position >= i.duration * PREPARE_AT || i.duration - i.position <= i.crossfade + PREPARE_LEAD_S;
}

/** How long the fade is for this song: the setting, but at most a third of the song (a short one isn't all fade). */
export function fadeLength(crossfade: number, duration: number): number {
  return Math.max(0, Math.min(crossfade, duration / 3));
}

/** Whether the fade into the prepared next song starts now (it's that close to the end). */
export function shouldStartFade(i: ClockInput): boolean {
  if (!i.eligible || i.crossfade <= 0 || !(i.duration > 0) || !Number.isFinite(i.duration)) return false;
  const len = fadeLength(i.crossfade, i.duration);
  return len >= 0.5 && i.duration - i.position <= len;
}

/**
 * Equal-power gains at fade progress `p` (0–1): the sum of the two songs' power stays even, so the middle of the
 * fade doesn't dip the way a straight line does.
 */
export function fadeGains(p: number): { out: number; in: number } {
  const t = Math.max(0, Math.min(1, p));
  return { out: Math.cos((t * Math.PI) / 2), in: Math.sin((t * Math.PI) / 2) };
}
