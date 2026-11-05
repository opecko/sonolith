// Recap playlists: which songs go into Top songs, Discoveries and On repeat. Pure; the actions (play, queue, save
// to the library) are in playlistActions.ts.
import type { Track } from "../api/types";
import type { Period } from "./periods";
import { periodTitle } from "./periods";
import type { RecapStats, TrackStat } from "./stats";

export type PlaylistKind = "top" | "discoveries" | "onRepeat";

export const PLAYLIST_KINDS: PlaylistKind[] = ["top", "discoveries", "onRepeat"];

export const PLAYLIST_LABEL: Record<PlaylistKind, string> = { top: "Top songs", discoveries: "Discoveries", onRepeat: "On repeat" };

/** How many songs each playlist takes. */
export function playlistSize(kind: PlaylistKind, period: Period): number {
  if (kind === "top") return period.kind === "year" ? 100 : 30;
  return period.kind === "year" ? 50 : 25;
}

/** One entry per song (by identity and by video id), in the given order. */
export function dedupe(list: TrackStat[]): TrackStat[] {
  const keys = new Set<string>(), ids = new Set<string>();
  return list.filter((t) => {
    if (keys.has(t.key) || ids.has(t.videoId)) return false;
    keys.add(t.key);
    ids.add(t.videoId);
    return true;
  });
}

/**
 * The songs of a recap playlist. Top songs: by plays, then listened time, then recency (the stats' order).
 * Discoveries: songs first heard in the period, most played first. On repeat: songs played at least twice in one
 * day, by their busiest day. Empty when there's nothing honest to put in.
 */
export function selectTracks(kind: PlaylistKind, s: RecapStats, period: Period): TrackStat[] {
  const n = playlistSize(kind, period);
  switch (kind) {
    case "top":
      return dedupe(s.rankedTracks).slice(0, n);
    case "discoveries":
      return dedupe(s.discoveries?.top ?? []).slice(0, n);
    case "onRepeat":
      return dedupe(s.rankedTracks.filter((t) => t.bestDay >= 2))
        .sort((a, b) => b.bestDay - a.bestDay || b.plays - a.plays || (a.key < b.key ? -1 : 1))
        .slice(0, n);
  }
}

/** A recap song as a playable track. */
export const asTrack = (t: TrackStat): Track => ({
  type: "track",
  id: t.videoId,
  title: t.title,
  subtitle: t.artist,
  artists: t.artist.split(", "),
  artistIds: [t.artistId ?? undefined],
  thumbnail: t.thumbnail,
  album: t.album ? { title: t.album } : undefined,
  video: t.video || undefined,
});

export const playlistTitle = (kind: PlaylistKind, period: Period) => `${PLAYLIST_LABEL[kind]} · ${periodTitle(period)}`;

export const playlistDescription = (period: Period) => `Made by Sonolith from my listening in ${periodTitle(period)}`;
