/**
 * Keeping a muted <video> on the <audio> clock (Now Playing's video mode), as a pure decision per tick so it can be
 * tested. The audio is the clock and never waits for the video.
 *
 * Two traps shape it (docs/dev/pitfalls.md):
 * - A seek on a streamed video takes longer than a small drift (a new Range request, a keyframe, buffering), so
 *   seeking on every bit of drift never lands: after a user seek the video was always "behind" again by the time it
 *   got there. Seeks therefore aim ahead by how long the last one took (`lead`), and there's no new one while one
 *   is landing or within `SEEK_COOLDOWN_S`.
 * - On WebKitGTK a playbackRate change is a GStreamer seek too (the pipeline flushes, the picture blinks), so drift
 *   is never corrected by nudging the rate: the video plays at the audio's rate and only a real drift seeks.
 */

/** Drift (s) the eye doesn't catch on a muted picture; up to this the video just plays on. */
export const TOLERANCE_S = 0.25;
export const SEEK_COOLDOWN_S = 2;
/** The seek lead is the last seek's measured time, within these bounds. */
export const MIN_LEAD_S = 0.05;
export const MAX_LEAD_S = 1;

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
  /** How long a seek takes to land here (seconds, measured); seeks aim this far ahead of the audio. */
  lead: number;
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
  const off = Math.abs(i.videoTime - i.audioTime) > TOLERANCE_S;
  // Paused audio: the video stands still where the audio is (no playback to race, so no lead).
  if (!i.audioPlaying) return { rate: i.audioRate, play: false, seek: (i.force || off) && !i.videoBusy ? clamp(i.audioTime) : undefined };
  const ahead = clamp(i.audioTime + Math.min(MAX_LEAD_S, Math.max(MIN_LEAD_S, i.lead)) * i.audioRate);
  if (i.force) return { rate: i.audioRate, play: true, seek: ahead };
  if (!off || i.videoBusy || i.sinceSeek < SEEK_COOLDOWN_S) return { rate: i.audioRate, play: true };
  return { rate: i.audioRate, play: true, seek: ahead };
}

/** The next lead from a seek that just took `took` seconds to land: smoothed, so one slow seek doesn't overshoot. */
export function nextLead(lead: number, took: number) {
  return Math.min(MAX_LEAD_S, Math.max(MIN_LEAD_S, lead * 0.5 + took * 0.5));
}
