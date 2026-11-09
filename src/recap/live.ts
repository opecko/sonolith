// Live stats on the Recaps page: today, the last 7 days and this month so far, from the same merged plays the
// recaps use (pure). Plays whose day is only known as a range (YouTube's history page) count only when the range
// is a single day; the rest would be guesses.
import { dayOf, ymdOf, dayFromYmd } from "./days";
import type { Play } from "./merge";

export type LiveWindow = "today" | "week" | "month";

export interface LiveStats {
  window: LiveWindow;
  plays: number;
  listenedMs: number;
  topArtist: { name: string; plays: number } | null;
  topSong: { title: string; artist: string; plays: number; thumbnail?: string } | null;
}

/** First day (inclusive) of each window, ending today. */
export function windowStart(w: LiveWindow, today: number): number {
  if (w === "today") return today;
  if (w === "week") return today - 6;
  const { y, m } = ymdOf(today);
  return dayFromYmd(y, m, 1);
}

/** The most frequent key (ties: the one reached first). */
function top<T>(items: T[], key: (t: T) => string): { item: T; count: number } | null {
  const counts = new Map<string, { item: T; count: number }>();
  for (const it of items) {
    const k = key(it);
    const c = counts.get(k);
    if (c) c.count++;
    else counts.set(k, { item: it, count: 1 });
  }
  let best: { item: T; count: number } | null = null;
  for (const c of counts.values()) if (!best || c.count > best.count) best = c;
  return best;
}

export function liveStats(plays: Play[], now: number, w: LiveWindow): LiveStats {
  const today = dayOf(now);
  const from = windowStart(w, today);
  const inside = plays.filter((p) => (p.at !== null ? p.at <= now && dayOf(p.at) >= from : p.from === p.to && p.from >= from && p.from <= today));
  const songs = inside.filter((p) => p.type !== "episode");
  const artist = top(songs.filter((p) => p.artists.length), (p) => p.artists[0].name);
  const song = top(songs, (p) => p.key);
  return {
    window: w,
    plays: inside.length,
    listenedMs: inside.reduce((n, p) => n + p.listenedMs, 0),
    topArtist: artist && artist.count > 1 ? { name: artist.item.artists[0].name, plays: artist.count } : null,
    topSong: song && song.count > 1
      ? { title: song.item.title, artist: song.item.artists.map((a) => a.name).join(", "), plays: song.count, thumbnail: song.item.thumbnail }
      : null,
  };
}
