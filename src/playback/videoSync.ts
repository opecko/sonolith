/**
 * Keeping a muted <video> on the <audio> clock (Now Playing's video mode), as a pure decision per tick so it can be
 * tested. The audio is the clock and never waits for the video.
 *
 * Two traps shape it (docs/dev/pitfalls.md):
 * - A seek on a streamed video takes longer than a small drift (a new Range request, a keyframe, buffering), so
 *   seeking on every bit of drift never lands: after a user seek the video was always "behind" again by the time it
 *   got there. Seeks therefore aim ahead (`lead`), learnt from where the last ones really landed once playing again
 *   (`learn`; the `seeked` event comes before the picture moves), and there's no new one while one is landing or
 *   within the cooldown. Seeks that keep missing widen the tolerance and the cooldown instead of blinking forever.
 * - On WebKitGTK a playbackRate change is a GStreamer seek too (the pipeline flushes, the picture blinks), so drift
 *   is never corrected by nudging the rate: the video plays at the audio's rate and only a real drift seeks.
 */

/** Drift (s) the eye doesn't catch on a muted picture; up to this the video just plays on. */
export const TOLERANCE_S = 0.25;
export const SEEK_COOLDOWN_S = 2;
/** The seek lead stays within these bounds. */
export const MIN_LEAD_S = 0;
export const MAX_LEAD_S = 1.5;

/** What seeks taught so far: how far ahead to aim, and how many in a row missed. */
export interface Learnt {
  lead: number;
  misses: number;
}
export const FIRST_GUESS: Learnt = { lead: 0.2, misses: 0 };

/** Drift let be: wider after misses (up to 2 s), so a video that can't keep up isn't seeked over and over. */
export const tolerance = (l: Learnt) => Math.min(2, TOLERANCE_S * 2 ** l.misses);
/** Time between corrective seeks, longer after misses too. */
export const cooldown = (l: Learnt) => Math.min(30, SEEK_COOLDOWN_S * 2 ** l.misses);

export interface SyncInput {
  /** Audio position and rate; `audioPlaying` false when paused, ended or waiting for data. */
  audioTime: number;
  audioRate: number;
  audioPlaying: boolean;
  videoTime: number;
  /** The video is seeking (or has no frame for its position yet). */
  videoBusy: boolean;
  /** Seconds since the last seek this controller issued (Infinity: never). */
  sinceSeek: number;
  learnt: Learnt;
  /** Seek now (the user seeked the audio, the video just loaded, the window came back). */
  force?: boolean;
  /** Video duration, when known: seeks never aim past its end. */
  videoDuration?: number;
}

export interface SyncAction {
  /** Seek the video here, if set. */
  seek?: number;
  /** Playback rate for the video: always the audio's (see above). */
  rate: number;
  /** Whether the video should be playing. */
  play: boolean;
}

export function videoSync(i: SyncInput): SyncAction {
  const clamp = (t: number) => Math.max(0, i.videoDuration && Number.isFinite(i.videoDuration) ? Math.min(t, i.videoDuration - 0.05) : t);
  const off = Math.abs(i.videoTime - i.audioTime) > tolerance(i.learnt);
  // Paused audio: the video stands still where the audio is (no playback to race, so no lead).
  if (!i.audioPlaying) return { rate: i.audioRate, play: false, seek: (i.force || off) && !i.videoBusy ? clamp(i.audioTime) : undefined };
  const ahead = clamp(i.audioTime + i.learnt.lead * i.audioRate);
  if (i.force) return { rate: i.audioRate, play: true, seek: ahead };
  if (!off || i.videoBusy || i.sinceSeek < cooldown(i.learnt)) return { rate: i.audioRate, play: true };
  return { rate: i.audioRate, play: true, seek: ahead };
}

/**
 * After a seek, once the video plays again: `behind` = audio time − video time. Still behind means aim further
 * ahead next time (ahead: less far); a landing outside the tolerance counts as a miss, one inside clears them.
 */
export function learn(l: Learnt, behind: number): Learnt {
  const lead = Math.min(MAX_LEAD_S, Math.max(MIN_LEAD_S, l.lead + behind * 0.8));
  return { lead, misses: Math.abs(behind) > TOLERANCE_S ? Math.min(l.misses + 1, 4) : 0 };
}

/**
 * A live stream's video: it plays from the proxy as one endless stream that starts at a segment boundary just ahead
 * of the audio (`TrackVideo`), so it can't seek. It waits (paused) while it's ahead, plays while in step, and asks
 * for a new connection, again just ahead, when it has fallen behind (a stall).
 * Times are from each stream's own start, the video's shifted by where it began relative to the audio.
 */
export function liveVideoSync(i: { audioTime: number; videoTime: number; audioPlaying: boolean }): "play" | "wait" | "reconnect" {
  if (!i.audioPlaying) return "wait";
  const d = i.videoTime - i.audioTime;
  if (d > TOLERANCE_S) return "wait";
  if (d < -LIVE_BEHIND_S) return "reconnect";
  return "play";
}
/** How far a live video may fall behind before it reconnects (it can't seek). */
export const LIVE_BEHIND_S = 2;
