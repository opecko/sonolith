// Recap periods: when each becomes available, what it covers, and whether there's enough listening. Pure; "now" is
// always passed in (Recaps use clock.ts, tests a fixed date). All boundaries are local midnights (DST-correct).
import { dayFromYmd, dayOf, MONTHS, startOfDay } from "./days";
import type { Play } from "./merge";

export type Period = { kind: "month"; year: number; month: number } | { kind: "year"; year: number };

/** Plays a recap needs before it's made ("Not enough listening yet" below that). */
export const MIN_PLAYS = { month: 20, year: 50 } as const;

/** Stable id, also the snapshot's file name: "month-2026-10" (month 1-based), "year-2026". */
export const periodId = (p: Period) => (p.kind === "month" ? `month-${p.year}-${String(p.month + 1).padStart(2, "0")}` : `year-${p.year}`);

export function parsePeriodId(id: string): Period | null {
  let m = id.match(/^month-(\d{4})-(\d{2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { kind: "month", year: Number(m[1]), month: Number(m[2]) - 1 };
  m = id.match(/^year-(\d{4})$/);
  return m ? { kind: "year", year: Number(m[1]) } : null;
}

export const periodTitle = (p: Period) => (p.kind === "month" ? `${MONTHS[p.month]} ${p.year}` : `${p.year}`);

/** The period before (a comparison needs it). */
export const previousPeriod = (p: Period): Period =>
  p.kind === "year" ? { kind: "year", year: p.year - 1 } : p.month === 0 ? { kind: "month", year: p.year - 1, month: 11 } : { kind: "month", year: p.year, month: p.month - 1 };

/** First moment of the period, epoch ms. */
export const periodStart = (p: Period) => startOfDay(p.kind === "month" ? dayFromYmd(p.year, p.month, 1) : dayFromYmd(p.year, 0, 1));

/** Normal end: a month ends when the next one starts; a year's recap covers Jan 1 → Nov 1. */
export const periodEnd = (p: Period) => startOfDay(p.kind === "month" ? dayFromYmd(p.year, p.month + 1, 1) : dayFromYmd(p.year, 10, 1));

/** When the yearly recap may be unlocked early (Oct 15) — until it unlocks by itself on Nov 1. */
export const earlyUnlockFrom = (year: number) => startOfDay(dayFromYmd(year, 9, 15));

export function canUnlockEarly(year: number, now: number, unlockedAt: number | null): boolean {
  return unlockedAt === null && now >= earlyUnlockFrom(year) && now < periodEnd({ kind: "year", year });
}

/**
 * Where the period stops counting: the normal end, or for a year unlocked early the moment it was unlocked. Null
 * while it isn't available yet.
 */
export function cutoffOf(p: Period, now: number, earlyUnlockAt: number | null = null): number | null {
  const end = periodEnd(p);
  if (now >= end) return p.kind === "year" && earlyUnlockAt !== null && earlyUnlockAt < end ? Math.max(periodStart(p), earlyUnlockAt) : end;
  if (p.kind === "year" && earlyUnlockAt !== null && earlyUnlockAt <= now) return earlyUnlockAt;
  return null;
}

/** Whole days until a locked period opens (0 on the day it opens). */
export const daysUntil = (at: number, now: number) => Math.max(0, dayOf(at) - dayOf(now));

/**
 * Plays inside [start, cutoff). Exact plays go by time; a history play known only to a range of days goes by the
 * middle of its range and only when that day is wholly before the cutoff.
 */
export function playsIn(plays: Play[], start: number, cutoff: number): Play[] {
  const firstDay = dayOf(start);
  // A cutoff in the middle of a day (an early unlock) leaves that day out for plays without a time.
  const cutDay = dayOf(cutoff);
  return plays.filter((p) => {
    if (p.at !== null) return p.at >= start && p.at < cutoff;
    const mid = Math.floor((p.from + p.to) / 2);
    return mid >= firstDay && mid < cutDay;
  });
}

export type Availability =
  | { state: "locked"; opensAt: number; daysLeft: number }
  | { state: "notEnough"; plays: number; needed: number }
  | { state: "ready"; cutoff: number };

/** Whether a period's recap can be shown now, from the plays known (before it's frozen). */
export function availability(p: Period, now: number, plays: Play[], earlyUnlockAt: number | null = null): Availability {
  const cutoff = cutoffOf(p, now, earlyUnlockAt);
  if (cutoff === null) {
    const opensAt = periodEnd(p);
    return { state: "locked", opensAt, daysLeft: daysUntil(opensAt, now) };
  }
  const n = playsIn(plays, periodStart(p), cutoff).length;
  const needed = MIN_PLAYS[p.kind];
  return n < needed ? { state: "notEnough", plays: n, needed } : { state: "ready", cutoff };
}

/** Months to list, newest first: from the first month with data (or this one) up to the current month. */
export function monthsToList(now: number, firstDay: number | null): Period[] {
  const d = new Date(now);
  const out: Period[] = [];
  let y = d.getFullYear(), m = d.getMonth();
  const stop = firstDay === null ? { y, m } : (() => {
    const f = new Date(startOfDay(firstDay));
    return { y: f.getFullYear(), m: f.getMonth() };
  })();
  for (let i = 0; i < 240; i++) {
    out.push({ kind: "month", year: y, month: m });
    if (y < stop.y || (y === stop.y && m <= stop.m)) break;
    if (--m < 0) (m = 11), y--;
  }
  return out;
}
