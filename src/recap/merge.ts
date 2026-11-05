// One list of plays from the local play log and YouTube's history (docs/dev/recap.md). A song and its music video
// are one track (normalized title + primary artist). Per day and track the larger count of the two sources wins, so
// nothing is counted twice and plays on other devices still count.
import { baseTitle } from "../api/songVersions";
import { dayOf } from "./days";
import type { PlayEntry, PlayKind, TrackInfo } from "./playLog";
import type { HistoryPlay } from "./ytHistory";

export interface Play {
  /** Canonical track identity (trackKey). */
  key: string;
  videoId: string;
  type: PlayKind;
  title: string;
  artists: { id: string | null; name: string }[];
  album: { id: string | null; title: string } | null;
  durationMs: number;
  thumbnail?: string;
  /** Local day range of the play; equal when the day is known exactly. */
  from: number;
  to: number;
  /** Exact start, epoch ms (log plays only). */
  at: number | null;
  listenedMs: number;
  /** listenedMs is the track's length, not measured. */
  estimated: boolean;
  completed: boolean;
  origin: "log" | "youtube";
}

export interface Dataset {
  plays: Play[];
  /** Skipped tracks from the log (for "most skipped"). */
  skips: Play[];
}

/** A typical track length, for history plays whose length isn't known. */
export const FALLBACK_DURATION_MS = 210_000;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** An artist name for comparing: no " - Topic" / "VEVO" channel suffixes, letters and digits only, no spaces. */
const artistNorm = (name: string) => norm(name.replace(/\s*-\s*topic$/i, "").replace(/vevo$/i, "")).replace(/ /g, "");

/** Canonical identity: bare title (no "(Official Video)", no "Artist - " prefix) + primary artist. */
export function trackKey(title: string, artists: { id: string | null; name: string }[]): string {
  const artist = artists[0] ? artistNorm(artists[0].name) : "";
  let t = title;
  // Music videos are often titled "Artist - Song (Official Video)".
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && artist && artistNorm(m[1]).includes(artist)) t = m[2];
  return `${baseTitle(t)}|${artist}`;
}

function fromInfo(info: TrackInfo | PlayEntry) {
  return {
    key: trackKey(info.title, info.artists),
    videoId: info.videoId,
    type: info.type,
    title: info.title,
    artists: info.artists,
    album: info.album,
    durationMs: info.durationMs,
    thumbnail: info.thumbnail,
  };
}

export function mergePlays(log: PlayEntry[], history: HistoryPlay[]): Dataset {
  const plays: Play[] = [];
  const skips: Play[] = [];
  for (const e of log) {
    const day = dayOf(e.startedAt);
    const p: Play = { ...fromInfo(e), from: day, to: day, at: e.startedAt, listenedMs: e.listenedMs, estimated: false, completed: e.completed, origin: "log" };
    (e.skipped ? skips : plays).push(p);
  }
  // Per (day, track): local plays already there.
  const local = new Map<string, number>();
  const localDays = new Map<string, number[]>();
  for (const p of plays) {
    local.set(`${p.from}|${p.key}`, (local.get(`${p.from}|${p.key}`) ?? 0) + 1);
    localDays.set(p.key, [...(localDays.get(p.key) ?? []), p.from]);
  }
  const yt = history.map((h) => ({ h, base: fromInfo(h.track) }));
  // Exact days first, then ranges (a range is covered by any play of the track inside it).
  const exact = new Map<string, number>();
  const accepted: Play[] = [];
  const toPlay = (h: HistoryPlay, base: ReturnType<typeof fromInfo>): Play => {
    const dur = base.durationMs > 0 ? base.durationMs : FALLBACK_DURATION_MS;
    return { ...base, durationMs: base.durationMs, from: h.from, to: h.to, at: null, listenedMs: dur, estimated: true, completed: true, origin: "youtube" };
  };
  for (const { h, base } of yt) {
    if (h.from !== h.to) continue;
    const k = `${h.from}|${base.key}`;
    const n = (exact.get(k) ?? 0) + 1;
    exact.set(k, n);
    if (n > (local.get(k) ?? 0)) accepted.push(toPlay(h, base));
  }
  for (const { h, base } of yt) {
    if (h.from === h.to) continue;
    const inRange = (d: number) => d >= h.from && d <= h.to;
    if ((localDays.get(base.key) ?? []).some(inRange)) continue;
    if (accepted.some((p) => p.key === base.key && p.from >= h.from && p.to <= h.to)) continue;
    accepted.push(toPlay(h, base));
  }
  const all = [...plays, ...accepted].sort((a, b) => a.from - b.from || (a.at ?? 0) - (b.at ?? 0));
  return { plays: all, skips };
}

/** The first day the data says anything about (null: no data at all). */
export function firstDay(d: Dataset): number | null {
  let first: number | null = null;
  for (const p of d.plays) if (first === null || p.from < first) first = p.from;
  return first;
}
