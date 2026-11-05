// Music under a recap: your top songs, one per stretch of the story (thirds with three songs), each starting about
// a third of the way in (past the intro, near the chorus). Pure; player/useRecapMusic.ts plays it.
import type { TrackStat } from "./stats";

/** At most this many songs share a recap. */
export const MUSIC_SONGS = 3;

/** The songs to play: the recap's top songs, in order. */
export const musicTracks = (top: TrackStat[]) => top.slice(0, MUSIC_SONGS);

/** Which song (index) plays under card `index` of `cards` when there are `songs` of them: equal stretches. */
export function songFor(index: number, cards: number, songs: number): number {
  if (songs <= 1 || cards <= 1) return 0;
  return Math.min(songs - 1, Math.floor((index * songs) / cards));
}

/** Where a song starts, in seconds: a third of the way in for songs over a minute, else from the start. */
export const startAt = (durationSec: number) => (Number.isFinite(durationSec) && durationSec > 60 ? Math.round(durationSec * 0.3) : 0);

/** Volume of a crossfade step: the outgoing song from `v` to 0, the incoming from 0 to `v` (smoothstep). */
export function fade(p: number, v: number): { out: number; in: number } {
  const t = Math.max(0, Math.min(1, p));
  const s = t * t * (3 - 2 * t);
  return { out: v * (1 - s), in: v * s };
}
