// "Notify when the song changes" (Settings → Playback): which song gets a notification. Pure; stores/trackNotes.ts
// wires it to the player and Rust (track_note.rs) shows it.
import type { Track } from "../api/types";

export interface NoteState {
  enabled: boolean;
  /** The playing item, if any. */
  track: Track | undefined;
  playing: boolean;
  /** Sonolith is the focused window (then there's no need to say what's playing). */
  focused: boolean;
}

/**
 * The track to announce, or null: a new track once it actually plays (not while it loads, not a restored queue
 * sitting paused), while the setting is on and the window isn't focused. `last` is the id announced (or skipped)
 * last time, so a pause and resume doesn't announce the same song again.
 */
export function trackToAnnounce(s: NoteState, last: string | null): Track | null {
  if (!s.enabled || !s.track || !s.playing || s.track.id === last || s.focused) return null;
  return s.track;
}
