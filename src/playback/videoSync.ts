/**
 * Keeping a muted <video> on the <audio> clock (Now Playing's video mode), as a pure decision per tick so it can be
 * tested. The audio is the clock and never waits for the video.
 *
 * The old way seeked the video whenever it drifted more than a third of a second. A seek on a streamed video takes
 * longer than that (a new Range request, a keyframe, buffering), so after a user seek the video was always "behind"
 * again by the time it got there and kept seeking, never playing. Now:
 * - small drift is pulled in by nudging the video's playback rate (no seek, no stall);
 * - only a large drift seeks, aimed a little ahead of the audio to cover the seek's own time;
 * - no new seek while one is in flight or the video is still buffering, and not more than one every
 *   `SEEK_COOLDOWN_S`, so a slow network gets one seek that lands instead of a storm that never does.
 */

/** Drift (s) below which the video plays at the audio's rate. */
export const IN_SYNC_S = 0.04;
/** Drift (s) above which the video seeks instead of catching up by rate. */
export const SEEK_ABOVE_S = 0.9;
/** At most this much faster or slower than the audio while catching up. */
export const MAX_NUDGE = 0.12;
/** How far ahead of the audio a seek aims (the seek itself takes about this long on a warm stream). */
export const SEEK_LEAD_S = 0.15;
export const SEEK_COOLDOWN_S = 1.5;

export interface SyncInput {
  /** Audio position and rate; `audioPlaying` false when paused, ended or waiting for data. */
  audioTime: number;
  audioRate: number;
  audioPlaying: boolean;
  videoTime: number;
  /** The video is seeking, or doesn't have data for the current position yet. */
  videoBusy: boolean;
  /** Seconds since the last seek this controller issued (Infinity: never). */
  sinceSeek: number;
  /** Force an exact seek now (the user seeked the audio, the video just loaded, the window came back). */
  force?: boolean;
  /** Video duration, when known: seeks never aim past its end. */
  videoDuration?: number;
}

export interface SyncAction {
  /** Seek the video here, if set. */
  seek?: number;
  /** Playback rate for the video. */
  rate: number;
  /** Whether the video should be playing. */
  play: boolean;
}

export function videoSync(i: SyncInput): SyncAction {
  const clamp = (t: number) => Math.max(0, i.videoDuration && Number.isFinite(i.videoDuration) ? Math.min(t, i.videoDuration - 0.05) : t);
  // Paused audio: the video stands still exactly where the audio is (a precise seek is cheap without playback).
  if (!i.audioPlaying) {
    const off = Math.abs(i.videoTime - i.audioTime) > IN_SYNC_S;
    return { rate: i.audioRate, play: false, seek: (i.force || off) && !i.videoBusy ? clamp(i.audioTime) : undefined };
  }
  if (i.force) return { rate: i.audioRate, play: true, seek: clamp(i.audioTime + SEEK_LEAD_S) };
  // Let a seek land (and the video buffer) before judging the drift again.
  if (i.videoBusy) return { rate: i.audioRate, play: true };
  const drift = i.videoTime - i.audioTime; // > 0: the video is ahead
  if (Math.abs(drift) > SEEK_ABOVE_S) {
    if (i.sinceSeek < SEEK_COOLDOWN_S) return { rate: i.audioRate, play: true };
    return { rate: i.audioRate, play: true, seek: clamp(i.audioTime + SEEK_LEAD_S) };
  }
  if (Math.abs(drift) <= IN_SYNC_S) return { rate: i.audioRate, play: true };
  // Proportional: half a second off runs ~10 % faster or slower, which closes it in a few seconds without a visible jump.
  const nudge = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, -drift * 0.2));
  return { rate: i.audioRate * (1 + nudge), play: true };
}
