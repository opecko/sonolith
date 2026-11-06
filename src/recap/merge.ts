// One list of plays from the local play log and YouTube's history (docs/dev/recap.md). A song and its music video
// are one track (normalized title + primary artist). Per day and track the larger count of the two sources wins, so
// nothing is counted twice and plays on other devices still count.
import { baseTitle } from "../api/songVersions";
import { dayOf } from "./days";
import type { PlayEntry, PlayKind, TrackInfo } from "./playLog";
import type { TakeoutPlay } from "./takeout";
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
  origin: "log" | "takeout" | "youtube";
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

/** What a play says about its track. */
type TrackBase = Pick<Play, "key" | "videoId" | "type" | "title" | "artists" | "album" | "durationMs" | "thumbnail">;

function fromInfo(info: TrackInfo | PlayEntry): TrackBase {
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

/**
 * One list from three sources: Sonolith's log (exact, real listened time), Google Takeout (exact times, no length)
 * and YouTube's history page (day ranges). Per (day, track) the largest count of the three wins.
 */
export function mergePlays(log: PlayEntry[], history: HistoryPlay[], takeout: TakeoutPlay[] = []): Dataset {
  const plays: Play[] = [];
  const skips: Play[] = [];
  for (const e of log) {
    const day = dayOf(e.startedAt);
    const p: Play = { ...fromInfo(e), from: day, to: day, at: e.startedAt, listenedMs: e.listenedMs, estimated: false, completed: e.completed, origin: "log" };
    (e.skipped ? skips : plays).push(p);
  }
  const yt = history.map((h) => ({ h, base: fromInfo(h.track) }));
  // Takeout has no length, album or cover: borrow them from the same video (or song) elsewhere.
  const known = new Map<string, TrackBase>();
  for (const b of [...plays, ...yt.map((x) => x.base)]) {
    if (!known.has(b.videoId) || (b.durationMs && !known.get(b.videoId)!.durationMs)) known.set(b.videoId, b);
    if (!known.has(b.key)) known.set(b.key, b);
  }
  const estimate = (base: TrackBase, from: number, to: number, at: number | null, origin: Play["origin"]): Play => {
    const dur = base.durationMs > 0 ? base.durationMs : FALLBACK_DURATION_MS;
    return { ...base, from, to, at, listenedMs: dur, estimated: true, completed: true, origin };
  };

  // Per (day, track): the log's plays, then Takeout's beyond them (the ones nearest a logged play are its twins).
  const group = <T>(list: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of list) {
      const k = key(x);
      const l = m.get(k);
      if (l) l.push(x);
      else m.set(k, [x]);
    }
    return m;
  };
  const localBy = group(plays, (p) => `${p.from}|${p.key}`);
  const takeoutPlays = takeout.map((t) => {
    const named = t.artist ? [{ id: t.artistId, name: t.artist }] : [];
    const sameVideo = known.get(t.videoId);
    // Without a byline the title alone would join different songs: the same video's details, else the video itself.
    const artists = named.length ? named : sameVideo?.artists ?? [];
    const key = named.length || sameVideo ? trackKey(t.title, artists) : `${trackKey(t.title, [])}#${t.videoId}`;
    const borrowed = sameVideo ?? known.get(key);
    const base = { key, videoId: t.videoId, type: borrowed?.type ?? ("song" as const), title: t.title, artists, album: borrowed?.album ?? null, durationMs: borrowed?.durationMs ?? 0, thumbnail: borrowed?.thumbnail };
    const day = dayOf(t.at);
    return estimate(base, day, day, t.at, "takeout");
  });
  const added: Play[] = [];
  for (const [k, list] of group(takeoutPlays, (p) => `${p.from}|${p.key}`)) {
    const rest = [...list];
    for (const l of localBy.get(k) ?? []) {
      if (!rest.length) break;
      // Each logged play takes its nearest Takeout twin (Sonolith's plays reach the YouTube history too).
      let best = 0;
      rest.forEach((t, i) => Math.abs(t.at! - l.at!) < Math.abs(rest[best].at! - l.at!) && (best = i));
      rest.splice(best, 1);
    }
    added.push(...rest);
  }

  const exactPlays = [...plays, ...added];
  const count = new Map<string, number>();
  const days = new Map<string, number[]>();
  for (const p of exactPlays) {
    count.set(`${p.from}|${p.key}`, (count.get(`${p.from}|${p.key}`) ?? 0) + 1);
    const d = days.get(p.key);
    if (d) d.push(p.from);
    else days.set(p.key, [p.from]);
  }
  // History: exact days beyond what's there, then ranges no known play of the track falls inside.
  const accepted: Play[] = [];
  const exact = new Map<string, number>();
  for (const { h, base } of yt) {
    if (h.from !== h.to) continue;
    const k = `${h.from}|${base.key}`;
    const n = (exact.get(k) ?? 0) + 1;
    exact.set(k, n);
    if (n > (count.get(k) ?? 0)) accepted.push(estimate(base, h.from, h.to, null, "youtube"));
  }
  for (const { h, base } of yt) {
    if (h.from === h.to) continue;
    const inRange = (d: number) => d >= h.from && d <= h.to;
    if ((days.get(base.key) ?? []).some(inRange)) continue;
    if (accepted.some((p) => p.key === base.key && p.from >= h.from && p.to <= h.to)) continue;
    accepted.push(estimate(base, h.from, h.to, null, "youtube"));
  }
  const all = [...exactPlays, ...accepted].sort((a, b) => a.from - b.from || (a.at ?? 0) - (b.at ?? 0));
  return { plays: all, skips };
}

/** The first day the data says anything about (null: no data at all). */
export function firstDay(d: Dataset): number | null {
  let first: number | null = null;
  for (const p of d.plays) if (first === null || p.from < first) first = p.from;
  return first;
}
