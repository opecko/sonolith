import { describe, expect, it } from "vitest";
import { dayFromYmd as D, startOfDay } from "./days";
import { mergePlays, type Play } from "./merge";
import {
  availability, canUnlockEarly, cutoffOf, daysUntil, earlyUnlockFrom, monthsToList, parsePeriodId, periodEnd, periodId, periodStart, playsIn,
  previousPeriod, type Period,
} from "./periods";
import { buildSnapshot, deepFreeze, freezesNow, historyFresh, keepFrozen, parseSnapshot, previewUsable } from "./snapshot";
import { syntheticLog } from "./synthetic";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min).getTime();
const oct: Period = { kind: "month", year: 2026, month: 9 };
const y2026: Period = { kind: "year", year: 2026 };

describe("ids and boundaries", () => {
  it("round-trips ids", () => {
    expect(periodId(oct)).toBe("month-2026-10");
    expect(parsePeriodId("month-2026-10")).toEqual(oct);
    expect(parsePeriodId("year-2026")).toEqual(y2026);
    expect(parsePeriodId("month-2026-13")).toBeNull();
    expect(previousPeriod({ kind: "month", year: 2026, month: 0 })).toEqual({ kind: "month", year: 2025, month: 11 });
  });
  it("months start and end at local midnight, leap years included", () => {
    expect(periodStart(oct)).toBe(at(2026, 9, 1));
    expect(periodEnd(oct)).toBe(at(2026, 10, 1));
    expect(periodEnd({ kind: "month", year: 2028, month: 1 }) - periodStart({ kind: "month", year: 2028, month: 1 })).toBeGreaterThan(28.9 * 86_400_000);
    expect(periodEnd(y2026)).toBe(at(2026, 11, 1));
  });
});

describe("availability", () => {
  const plays = mergePlays(syntheticLog(2026, D(2026, 10, 30)), []).plays;

  it("a month opens on the 1st of the next one, 00:00", () => {
    expect(availability(oct, at(2026, 9, 31, 23, 59), plays)).toMatchObject({ state: "locked", daysLeft: 1 });
    expect(availability(oct, at(2026, 10, 1, 0, 0), plays).state).toBe("ready");
  });

  it("not enough listening", () => {
    const few = playsIn(plays, periodStart(oct), periodEnd(oct)).slice(0, 19);
    expect(availability(oct, at(2026, 11, 1), few)).toEqual({ state: "notEnough", plays: 19, needed: 20 });
  });

  it("the year unlocks on Dec 1, or early from Oct 15", () => {
    expect(cutoffOf(y2026, at(2026, 10, 30, 23), null)).toBeNull();
    expect(cutoffOf(y2026, at(2026, 11, 1), null)).toBe(at(2026, 11, 1));
    expect(canUnlockEarly(2026, at(2026, 9, 14, 23, 59), null)).toBe(false);
    expect(canUnlockEarly(2026, at(2026, 9, 15), null)).toBe(true);
    expect(canUnlockEarly(2026, at(2026, 10, 30, 23), null)).toBe(true);
    expect(canUnlockEarly(2026, at(2026, 11, 1), null)).toBe(false);
    expect(canUnlockEarly(2026, at(2026, 9, 20), at(2026, 9, 18))).toBe(false);
    const early = at(2026, 9, 20, 15, 30);
    expect(cutoffOf(y2026, at(2026, 9, 20, 16), early)).toBe(early);
    // Still the early moment after Dec 1.
    expect(cutoffOf(y2026, at(2027, 0, 5), early)).toBe(early);
    expect(earlyUnlockFrom(2026)).toBe(at(2026, 9, 15));
  });

  it("an early cutoff leaves out later plays and that day's undated ones", () => {
    const cut = at(2026, 9, 20, 15);
    const mk = (over: Partial<Play>): Play => ({ ...plays[0], ...over });
    const list = [mk({ at: at(2026, 9, 20, 14) }), mk({ at: at(2026, 9, 20, 16) }), mk({ at: null, from: D(2026, 9, 20), to: D(2026, 9, 20) }), mk({ at: null, from: D(2026, 9, 19), to: D(2026, 9, 19) })];
    expect(playsIn(list, periodStart(y2026), cut)).toHaveLength(2);
  });

  it("days to go count calendar days across DST", () => {
    expect(daysUntil(at(2026, 10, 1), at(2026, 9, 24, 23))).toBe(8);
    expect(daysUntil(at(2026, 2, 30), at(2026, 2, 28, 12))).toBe(2);
  });

  it("lists months from the first data", () => {
    const list = monthsToList(at(2026, 10, 5), D(2026, 7, 20)).map(periodId);
    expect(list).toEqual(["month-2026-11", "month-2026-10", "month-2026-09", "month-2026-08"]);
    expect(monthsToList(at(2026, 0, 5), null).map(periodId)).toEqual(["month-2026-01"]);
  });
});

describe("snapshots", () => {
  const log = syntheticLog(2026, D(2026, 10, 30));
  const data = mergePlays(log, []);

  it("are frozen and never replaced", () => {
    const a = buildSnapshot(oct, data, periodEnd(oct), at(2026, 10, 2), { frozen: true, podcasts: false, youtube: false });
    const more = mergePlays([...log, ...syntheticLog(2026, D(2026, 10, 30), 99)], []);
    const b = buildSnapshot(oct, more, periodEnd(oct), at(2026, 10, 3), { frozen: true, podcasts: false, youtube: false });
    expect(b.stats.plays).toBeGreaterThan(a.stats.plays);
    expect(keepFrozen(a, b)).toBe(a);
    expect(keepFrozen({ ...a, frozen: false }, b)).toBe(b);
    expect(keepFrozen(null, b)).toBe(b);
  });

  it("round-trip through JSON and come back immutable", () => {
    const a = buildSnapshot(oct, data, periodEnd(oct), at(2026, 10, 2), { frozen: true, podcasts: false, youtube: false });
    const back = parseSnapshot(JSON.parse(JSON.stringify(a)))!;
    expect(back).toEqual(a);
    expect(() => {
      (back.stats as { plays: number }).plays = 1;
    }).toThrow();
    expect(parseSnapshot({ ...a, schema: 99 })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });

  it("say honestly where the data starts", () => {
    const late = mergePlays(log.filter((e) => e.startedAt >= at(2026, 9, 12)), []);
    const s = buildSnapshot(oct, late, periodEnd(oct), at(2026, 10, 2), { frozen: true, podcasts: false, youtube: false });
    expect(s.coveredFrom).toBe(D(2026, 9, 12));
    expect(s.stats.comparison).toBeNull(); // no data for September
    const full = buildSnapshot(oct, data, periodEnd(oct), at(2026, 10, 2), { frozen: true, podcasts: false, youtube: false });
    expect(full.coveredFrom).toBe(D(2026, 9, 1));
    expect(full.stats.comparison).not.toBeNull();
    expect(full.lastDay).toBe(D(2026, 9, 31));
  });

  it("freeze rules", () => {
    expect(freezesNow(false, false)).toBe(true);
    expect(freezesNow(true, true)).toBe(true);
    expect(freezesNow(true, false)).toBe(false);
  });

  it("deepFreeze leaves primitives alone", () => {
    expect(deepFreeze(3)).toBe(3);
    expect(Object.isFrozen(deepFreeze({ a: { b: 1 } }).a)).toBe(true);
    expect(startOfDay(D(2026, 0, 1))).toBe(at(2026, 0, 1));
  });

  it("an early-unlocked year needs a history import from after the unlock to freeze", () => {
    const unlock = at(2026, 10, 5, 20, 59);
    const imported = at(2026, 10, 5, 20, 23);
    // The import 36 minutes before the unlock is recent, but doesn't cover the unlock moment.
    expect(historyFresh(imported, unlock + 60_000, unlock)).toBe(false);
    expect(historyFresh(unlock + 30_000, unlock + 60_000, unlock)).toBe(true);
    // A month: any import after its end within the last hour.
    expect(historyFresh(at(2026, 10, 2, 9), at(2026, 10, 2, 9, 30), periodEnd(oct))).toBe(true);
    expect(historyFresh(at(2026, 10, 2, 7), at(2026, 10, 2, 9, 30), periodEnd(oct))).toBe(false);
  });

  it("a thin preview isn't shown as a recap", () => {
    const tiny = mergePlays(log.filter((e) => e.startedAt >= at(2026, 10, 5, 12) && e.startedAt < at(2026, 10, 5, 21)), []);
    const preview = buildSnapshot(y2026, tiny, at(2026, 10, 5, 21), at(2026, 10, 5, 21), { frozen: false, podcasts: false, youtube: false });
    expect(previewUsable(preview)).toBe(false);
    expect(previewUsable({ ...preview, frozen: true })).toBe(true);
    expect(previewUsable(buildSnapshot(y2026, data, at(2026, 10, 5, 21), at(2026, 10, 5, 21), { frozen: false, podcasts: false, youtube: false }))).toBe(true);
  });
});
