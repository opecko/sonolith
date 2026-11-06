// Frozen recaps. Once made, a recap's numbers never change: not when more history is imported later, not when the log
// is deleted. Each is a versioned JSON snapshot on disk (`snapshots/<period id>.json`); only the dev toolkit deletes or
// remakes one. The presentation (cards, styles, games) is chosen anew per viewing from these frozen numbers.
import { dayOf } from "./days";
import { firstDay as firstDayOf, type Dataset } from "./merge";
import { MIN_PLAYS, periodId, periodStart, playsIn, previousPeriod, type Period } from "./periods";
import { computeStats, type RecapStats } from "./stats";

export const SNAPSHOT_SCHEMA = 1;

export interface Snapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  id: string;
  period: Period;
  createdAt: number;
  /** Where counting stopped (end of the month, Dec 1, or the moment of an early unlock). */
  cutoff: number;
  /** First day the recap's data covers ("Based on your history since …" when later than the period's start). */
  coveredFrom: number;
  /** Last day inside the period. */
  lastDay: number;
  /** Where its plays came from (`takeout`: an imported Google Takeout history; missing in older snapshots). */
  sources: { log: boolean; youtube: boolean; takeout?: boolean };
  /** False: a preview from local data only (offline), made again next time. */
  frozen: boolean;
  /** Podcasts counted (the setting when it was made). */
  podcasts: boolean;
  stats: RecapStats;
}

/** Makes a recap from the merged data as it is now. */
export function buildSnapshot(period: Period, data: Dataset, cutoff: number, now: number, opts: { frozen: boolean; podcasts: boolean; youtube: boolean }): Snapshot {
  const start = periodStart(period);
  const plays = playsIn(data.plays, start, cutoff);
  const before = data.plays.filter((p) => (p.at !== null ? p.at < start : p.to < dayOf(start)));
  const prevPeriod = previousPeriod(period);
  const prevStart = periodStart(prevPeriod);
  // The previous year is compared over the same stretch (Jan 1 to the same cutoff date a year earlier).
  const prevCut = period.kind === "year" ? new Date(new Date(cutoff).setFullYear(new Date(cutoff).getFullYear() - 1)).getTime() : start;
  const first = firstDayOf(data);
  const previous = first !== null && first <= dayOf(prevStart) ? playsIn(data.plays, prevStart, prevCut) : null;
  const periodFirst = dayOf(start);
  const lastDay = dayOf(cutoff - 1);
  const coveredFrom = Math.max(periodFirst, first ?? periodFirst);
  return {
    schema: SNAPSHOT_SCHEMA,
    id: periodId(period),
    period,
    createdAt: now,
    cutoff,
    coveredFrom,
    lastDay,
    sources: { log: plays.some((p) => p.origin === "log"), youtube: opts.youtube && plays.some((p) => p.origin === "youtube"), takeout: plays.some((p) => p.origin === "takeout") },
    frozen: opts.frozen,
    podcasts: opts.podcasts,
    stats: computeStats({
      plays, before, skips: playsIn(data.skips, start, cutoff), previous, kind: period.kind,
      firstDay: periodFirst, lastDay, includePodcasts: opts.podcasts,
    }),
  };
}

/**
 * Whether a recap opened now is frozen: signed in, only after this session's history import succeeded (otherwise
 * it's a preview from local data, made again later); signed out, from the local log alone, frozen right away.
 */
export const freezesNow = (signedIn: boolean, historyFresh: boolean) => !signedIn || historyFresh;

/**
 * Whether the imported history can freeze a recap: imported within the last hour and after the recap's cutoff (so
 * it holds everything up to it). An early-unlocked year's cutoff is the unlock moment, usually after the last import.
 */
export const historyFresh = (importedAt: number, now: number, cutoff: number) => importedAt >= now - 3_600_000 && importedAt >= cutoff;

/** A preview (local data only) is shown only when it has enough plays to be a recap at all. */
export const previewUsable = (snap: Snapshot) => snap.frozen || snap.stats.plays >= MIN_PLAYS[snap.period.kind];

/** The recap to show: a frozen one on disk always wins; nothing replaces it. */
export const keepFrozen = (stored: Snapshot | null, made: Snapshot): Snapshot => (stored?.frozen ? stored : made);

/** Recursively frozen at runtime too, so no code path can change a loaded recap by accident. */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

/** A stored snapshot, or null when it isn't one this version can read. */
export function parseSnapshot(v: unknown): Snapshot | null {
  const s = v as Snapshot;
  if (!s || typeof s !== "object" || s.schema !== SNAPSHOT_SCHEMA || typeof s.id !== "string" || !s.stats || !s.period) return null;
  if (!Array.isArray(s.stats.topTracks) || !Array.isArray(s.stats.topArtists) || !Number.isFinite(s.stats.plays)) return null;
  return deepFreeze(s);
}

/**
 * A yearly recap 2.5.0 may have frozen too thin after an early unlock: fewer plays than a recap needs, or, signed
 * in, without the YouTube history. Such a snapshot is made again (2.5.1's What's new runs the check once).
 */
export const thinEarlyYear = (s: Snapshot, signedIn: boolean) =>
  s.period.kind === "year" && s.frozen && (s.stats.plays < MIN_PLAYS.year || (signedIn && !s.sources.youtube && !s.sources.takeout));
