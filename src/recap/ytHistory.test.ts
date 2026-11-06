import { describe, expect, it } from "vitest";
import type { Shelf, Track } from "../api/types";
import { dayFromYmd as D, dayOf, startOfDay, ymdOf } from "./days";
import { bucketRange, EMPTY_HISTORY, importDue, mergeObservations, observe, parseHistoryCache } from "./ytHistory";

// Thursday, Nov 5, 2026
const today = D(2026, 10, 5);
const t = (id: string, extra: Partial<Track> = {}): Track => ({ type: "track", id, title: `Song ${id}`, subtitle: "", artists: ["Synthetic"], artistIds: ["UCsyn"], durationSec: 200, ...extra });

describe("days", () => {
  it("round-trips dates and handles leap years", () => {
    expect(ymdOf(D(2028, 1, 29))).toMatchObject({ y: 2028, m: 1, d: 29 });
    expect(D(2028, 2, 1) - D(2028, 1, 1)).toBe(29);
    expect(ymdOf(today).weekday).toBe(4);
  });
  it("local midnights across DST stay on their day", () => {
    for (const day of [D(2026, 2, 29), D(2026, 9, 25), D(2026, 2, 8), D(2026, 10, 1)]) {
      expect(dayOf(startOfDay(day))).toBe(day);
      expect(dayOf(startOfDay(day + 1) - 1)).toBe(day);
    }
  });
});

describe("bucketRange", () => {
  it("relative buckets", () => {
    expect(bucketRange("Today", today)).toEqual({ from: today, to: today });
    expect(bucketRange("Yesterday", today)).toEqual({ from: today - 1, to: today - 1 });
    expect(bucketRange("This week", today)).toEqual({ from: today - 6, to: today - 2 });
    expect(bucketRange("Last week", today)).toEqual({ from: today - 13, to: today - 2 });
  });
  it("months with and without a year", () => {
    expect(bucketRange("October 2026", today)).toEqual({ from: D(2026, 9, 1), to: D(2026, 9, 31) });
    expect(bucketRange("November 2026", today)).toEqual({ from: D(2026, 10, 1), to: today });
    expect(bucketRange("February 2028", D(2028, 5, 1))).toEqual({ from: D(2028, 1, 1), to: D(2028, 1, 29) });
    expect(bucketRange("December", today)).toEqual({ from: D(2025, 11, 1), to: D(2025, 11, 31) });
    expect(bucketRange("October", today)).toEqual({ from: D(2026, 9, 1), to: D(2026, 9, 31) });
    expect(bucketRange("December 2026", today)).toBeNull();
  });
  it("weekdays and dates", () => {
    expect(bucketRange("Monday", today)).toEqual({ from: D(2026, 10, 2), to: D(2026, 10, 2) });
    expect(bucketRange("Thursday", today)).toEqual({ from: D(2026, 9, 29), to: D(2026, 9, 29) });
    expect(bucketRange("Oct 12, 2026", today)).toEqual({ from: D(2026, 9, 12), to: D(2026, 9, 12) });
    expect(bucketRange("Dec 24", today)).toEqual({ from: D(2025, 11, 24), to: D(2025, 11, 24) });
    expect(bucketRange("12 October", today)).toEqual({ from: D(2026, 9, 12), to: D(2026, 9, 12) });
    expect(bucketRange("Feb 30, 2026", today)).toBeNull();
  });
  it("never guesses unknown headers", () => {
    for (const h of ["", "Earlier", "Dnes", "Recently played", "13/10/2026"]) expect(bucketRange(h, today)).toBeNull();
  });
});

describe("observe + merge", () => {
  const shelves = (s: [string, string[]][]): Shelf[] => s.map(([title, ids]) => ({ title, items: ids.map((id) => t(id)) }));

  it("skips unknown sections and repeated videos", () => {
    const o = observe([...shelves([["Today", ["a"]], ["Mystery", ["b"]], ["Yesterday", ["a", "c"]]]), { title: "Today", items: [{ type: "album", id: "x", title: "", subtitle: "" }] }], today);
    expect(o.map((x) => x.track.id)).toEqual(["a", "c"]);
  });

  it("narrows a play seen in later imports and adds newer plays", () => {
    // Day 1 (Mon): "a" played today.
    let c = mergeObservations(EMPTY_HISTORY, observe(shelves([["Today", ["a"]]]), today - 3), 1);
    // Thursday: "a" is now in "This week" (same play), "b" new in October.
    c = mergeObservations(c, observe(shelves([["This week", ["a"]], ["October 2026", ["b"]]]), today), 2);
    expect(c.plays.map((p) => [p.videoId, p.from, p.to])).toEqual([["b", D(2026, 9, 1), D(2026, 9, 31)], ["a", today - 3, today - 3]]);
    // Played again today: a second play.
    c = mergeObservations(c, observe(shelves([["Today", ["a"]]]), today), 3);
    expect(c.plays.filter((p) => p.videoId === "a").map((p) => p.from)).toEqual([today - 3, today]);
    expect(c.importedAt).toBe(3);
  });

  it("an observation older than the latest known play is ignored", () => {
    let c = mergeObservations(EMPTY_HISTORY, observe(shelves([["Today", ["a"]]]), today), 1);
    c = mergeObservations(c, observe(shelves([["October 2026", ["a"]]]), today), 2);
    expect(c.plays).toHaveLength(1);
  });

  it("parseHistoryCache drops junk", () => {
    expect(parseHistoryCache(null)).toBe(EMPTY_HISTORY);
    expect(parseHistoryCache({ version: 1, importedAt: 5, plays: [{ videoId: "a" }, { videoId: "b", from: 1, to: 1, track: { title: "x" } }] }).plays).toHaveLength(1);
  });

  it("importDue", () => {
    expect(importDue(0, 1000, false)).toBe(true);
    expect(importDue(1, 3_600_001, true)).toBe(true);
    expect(importDue(1, 3_600_001, false)).toBe(false);
    // Stamped in the future (a travelled dev clock): due again.
    expect(importDue(10_000_000, 3_600_001, false)).toBe(true);
  });
});
