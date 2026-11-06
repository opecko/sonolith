// YouTube Music's history as Recaps sees it (docs/dev/recap.md): one page of at most 200 videos, each under the
// bucket of its latest play ("Today", "This week", "October 2026"). Imports accumulate those observations into plays
// with a day range; an observation overlapping a known play of the same video is that play (the range narrows).
import type { Shelf, Track } from "../api/types";
import { dayFromYmd, daysInMonth, MONTHS, ymdOf, WEEKDAYS } from "./days";
import { trackInfo, type TrackInfo } from "./playLog";

/** A play known from YouTube's history: somewhere in days `from`..`to` (equal once the exact day is known). */
export interface HistoryPlay {
  videoId: string;
  from: number;
  to: number;
  track: TrackInfo;
  /** When an import first saw it, epoch ms. */
  seenAt: number;
}

export interface HistoryCache {
  version: 1;
  /** Last successful import, epoch ms (0: never). */
  importedAt: number;
  plays: HistoryPlay[];
}

export const EMPTY_HISTORY: HistoryCache = { version: 1, importedAt: 0, plays: [] };

const monthIndex = (name: string) => {
  const n = name.slice(0, 3).toLowerCase();
  return MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === n);
};

/** The latest year in which month `m` (day `d`) isn't after `today`: headers without a year. */
function inferYear(today: number, m: number, d = 1): number {
  const t = ymdOf(today);
  return dayFromYmd(t.y, m, d) <= today ? t.y : t.y - 1;
}

/**
 * The days a history section header covers, relative to `today` (a day number). Unknown headers give null (the
 * section is skipped, never guessed). Week buckets are wide on purpose: YouTube's week start isn't known, and
 * today/yesterday have their own buckets.
 */
export function bucketRange(header: string, today: number): { from: number; to: number } | null {
  const h = header.trim().replace(/\s+/g, " ");
  const lower = h.toLowerCase();
  if (lower === "today") return { from: today, to: today };
  if (lower === "yesterday") return { from: today - 1, to: today - 1 };
  if (lower === "this week") return { from: today - 6, to: today - 2 };
  if (lower === "last week") return { from: today - 13, to: today - 2 };
  if (lower === "this month") {
    const t = ymdOf(today);
    return { from: dayFromYmd(t.y, t.m, 1), to: today };
  }
  if (lower === "last month") {
    const t = ymdOf(today);
    return { from: dayFromYmd(t.y, t.m - 1, 1), to: dayFromYmd(t.y, t.m, 0) };
  }
  // A weekday: the latest such day before yesterday (within the past week).
  const wd = WEEKDAYS.findIndex((w) => w.toLowerCase() === lower);
  if (wd >= 0) {
    for (let day = today - 2; day >= today - 7; day--) if (ymdOf(day).weekday === wd) return { from: day, to: day };
    return null;
  }
  // "October 2026", "October"
  let m = h.match(/^([A-Za-z]{3,9})\.?(?: (\d{4}))?$/);
  if (m && monthIndex(m[1]) >= 0) {
    const mi = monthIndex(m[1]);
    const y = m[2] ? Number(m[2]) : inferYear(today, mi);
    const from = dayFromYmd(y, mi, 1);
    if (from > today) return null;
    return { from, to: Math.min(today, from + daysInMonth(y, mi) - 1) };
  }
  // "Oct 12, 2026", "October 12", "Oct 12"
  m = h.match(/^([A-Za-z]{3,9})\.? (\d{1,2})(?:, (\d{4}))?$/);
  if (m && monthIndex(m[1]) >= 0) return exact(monthIndex(m[1]), Number(m[2]), m[3], today);
  // "12 Oct 2026", "12 October"
  m = h.match(/^(\d{1,2}) ([A-Za-z]{3,9})\.?(?: (\d{4}))?$/);
  if (m && monthIndex(m[2]) >= 0) return exact(monthIndex(m[2]), Number(m[1]), m[3], today);
  return null;
}

function exact(m: number, d: number, year: string | undefined, today: number) {
  if (d < 1 || d > 31) return null;
  const y = year ? Number(year) : inferYear(today, m, d);
  if (d > daysInMonth(y, m)) return null;
  const day = dayFromYmd(y, m, d);
  return day > today ? null : { from: day, to: day };
}

/** One import's view: each video once, with the range of its latest play. */
export interface Observation {
  track: Track;
  from: number;
  to: number;
}

/** History shelves (as parsed by the shared browse parser) → observations; unknown headers and non-tracks skipped. */
export function observe(shelves: Shelf[], today: number): Observation[] {
  const out: Observation[] = [];
  const seen = new Set<string>();
  for (const s of shelves) {
    const r = bucketRange(s.title, today);
    if (!r) continue;
    for (const it of s.items) {
      if (it.type !== "track" || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({ track: it, ...r });
    }
  }
  return out;
}

/**
 * Adds an import's observations. Each is the video's latest play, so it can only be the latest known play of that
 * video (when their ranges overlap: the range narrows to the overlap and the details refresh) or a newer one.
 * Ambiguity resolves toward merging: a play is never counted twice, though two plays in one wide bucket can merge.
 */
export function mergeObservations(cache: HistoryCache, obs: Observation[], now: number): HistoryCache {
  const plays = cache.plays.map((p) => ({ ...p }));
  const latest = new Map<string, HistoryPlay>();
  for (const p of plays) {
    const l = latest.get(p.videoId);
    if (!l || p.to > l.to || (p.to === l.to && p.from > l.from)) latest.set(p.videoId, p);
  }
  for (const o of obs) {
    const l = latest.get(o.track.id);
    if (l && o.from <= l.to && o.to >= l.from) {
      l.from = Math.max(l.from, o.from);
      l.to = Math.min(l.to, o.to);
      l.track = trackInfo(o.track);
      continue;
    }
    if (l && o.to < l.from) continue; // older than what we know: it was removed and re-added, or a clock change
    const p: HistoryPlay = { videoId: o.track.id, from: o.from, to: o.to, track: trackInfo(o.track), seenAt: now };
    plays.push(p);
    latest.set(p.videoId, p);
  }
  plays.sort((a, b) => a.from - b.from || a.to - b.to);
  return { version: 1, importedAt: now, plays };
}

/** A stored cache, validated (unknown versions or shapes start over). */
export function parseHistoryCache(v: unknown): HistoryCache {
  const c = v as HistoryCache;
  if (!c || c.version !== 1 || !Array.isArray(c.plays)) return EMPTY_HISTORY;
  return {
    version: 1,
    importedAt: Number.isFinite(c.importedAt) ? c.importedAt : 0,
    plays: c.plays.filter((p) => p && typeof p.videoId === "string" && Number.isInteger(p.from) && Number.isInteger(p.to) && p.track && typeof p.track.title === "string"),
  };
}

/** Imports at most once a day in the background; opening Recaps imports whenever the last one is over an hour old. */
export function importDue(importedAt: number, now: number, opening: boolean): boolean {
  // A stamp in the future (a clock that was off) can't be trusted either.
  return importedAt <= 0 || importedAt > now || now - importedAt >= (opening ? 3_600_000 : 86_400_000);
}
