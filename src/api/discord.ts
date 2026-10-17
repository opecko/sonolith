// Pure Discord Rich Presence activity builder (sent to Rust, which talks to the Discord IPC socket).
import type { Track } from "./types";
import { hiResArt } from "./art";

export const ACTIVITY_LISTENING = 2;
/** status_display_type: 0 = app name, 1 = state, 2 = details. */
export const STATUS_DISPLAY_DETAILS = 2;
/** Art asset uploaded in the Discord application ("Rich Presence → Art Assets"). */
export const APP_ASSET = "ytdesk";

export interface PresenceInput {
  track: Track;
  playing: boolean;
  /** Seconds into the track. */
  position: number;
  duration: number;
  button: boolean;
  now?: number;
}

/** Discord rejects strings shorter than 2 or longer than 128 characters. */
export function fit(s: string | undefined, max = 128): string | undefined {
  const t = (s ?? "").trim();
  if (!t) return undefined;
  const chars = [...t];
  if (chars.length > max) return chars.slice(0, max - 1).join("") + "…";
  return chars.length < 2 ? t + " " : t;
}

/** External images must be https and under 256 characters, else Discord drops them; fall back to the app asset. */
export function artUrl(track: Track): string {
  const url = hiResArt(track.thumbnail, track.id)?.replace(/=w1200-h1200/, "=w512-h512");
  return url && url.startsWith("https://") && url.length < 256 ? url : APP_ASSET;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildActivity(p: PresenceInput): Record<string, any> {
  const { track } = p;
  const now = p.now ?? Date.now();
  // Never the list subtitle: from search that's e.g. "Song • 3:58 • 247M plays". The player fills artists from /next.
  // An episode says it's a podcast and names its show, where a song names its artists and album.
  const show = track.podcast ? track.show?.title || track.subtitle || undefined : undefined;
  const artist = track.podcast ? (show ? `Podcast · ${show}` : "Podcast") : track.artists.join(", ");
  const album = track.podcast ? show : track.album?.title;
  // status_display_type = details: the member list shows the track name instead of the app name.
  const activity: Record<string, unknown> = {
    type: ACTIVITY_LISTENING,
    status_display_type: STATUS_DISPLAY_DETAILS,
    details: fit(track.title) ?? "Unknown title",
    state: (artist ? fit(p.playing ? artist : `Paused · ${artist}`) : undefined) ?? (p.playing ? undefined : "Paused"),
    assets: {
      large_image: artUrl(track),
      ...(album ? { large_text: fit(album) } : {}),
      small_image: APP_ASSET,
      small_text: p.playing ? "ytdesk" : "Paused",
    },
  };
  // Start/end timestamps make Discord draw the progress bar; omitted while paused so the time stands still.
  if (p.playing && p.duration > 0) {
    const start = Math.round(now - p.position * 1000);
    activity.timestamps = { start, end: Math.round(start + p.duration * 1000) };
  }
  if (p.button) {
    activity.buttons = [{ label: "Listen on YouTube Music", url: `https://music.youtube.com/watch?v=${track.id}` }];
  }
  return activity;
}
