import { describe, expect, it } from "vitest";
import { dayFromYmd as D, startOfDay } from "./days";
import { mergePlays, type Play } from "./merge";
import { periodEnd, periodStart, playsIn } from "./periods";
import type { PlayEntry } from "./playLog";
import { computeStats, ELIGIBLE, MILESTONES, personaOf, type StatsInput } from "./stats";
import { syntheticLog } from "./synthetic";

const year = mergePlays(syntheticLog(2026, D(2026, 10, 30)), []);
const input = (plays: Play[], over: Partial<StatsInput> = {}): StatsInput => ({
  plays, before: [], skips: [], previous: null, kind: "month", firstDay: D(2026, 9, 1), lastDay: D(2026, 9, 31), includePodcasts: false, ...over,
});

let n = 0;
const play = (title: string, artist: string, day: number, hour = 12, extra: Partial<Play> = {}): Play => ({
  key: `${title}|${artist}`, videoId: `v${title}`, type: "song", title, artists: [{ id: `UC${artist}`, name: artist }], album: { id: `A${artist}`, title: `${artist} LP` },
  durationMs: 200_000, from: day, to: day, at: startOfDay(day) + hour * 3_600_000 + n++ * 1000, listenedMs: 200_000, estimated: false, completed: true, origin: "log", ...extra,
});

describe("computeStats on a synthetic year", () => {
  const oct = { kind: "month" as const, year: 2026, month: 9 };
  const start = periodStart(oct);
  const plays = playsIn(year.plays, start, periodEnd(oct));
  const s = computeStats(input(plays, { before: year.plays.filter((p) => (p.at ?? 0) < start), skips: playsIn(year.skips, start, periodEnd(oct)) }));

  it("is deterministic", () => {
    const again = computeStats(input(plays, { before: year.plays.filter((p) => (p.at ?? 0) < start), skips: playsIn(year.skips, start, periodEnd(oct)) }));
    expect(again).toEqual(s);
  });

  it("totals add up", () => {
    expect(s.plays).toBe(plays.length);
    expect(s.listenedMs).toBe(plays.reduce((a, p) => a + p.listenedMs, 0));
    expect(s.topTracks[0].plays).toBeGreaterThanOrEqual(s.topTracks[1].plays);
    expect(s.topArtists.length).toBe(5);
    expect(s.byHour!.reduce((a, b) => a + b, 0)).toBe(plays.length);
    expect(s.daily.reduce((a, d) => a + d.plays, 0)).toBe(plays.length);
    expect(s.estimatedShare).toBe(0);
  });

  it("has discoveries checked against earlier plays", () => {
    expect(s.discoveries).not.toBeNull();
    const before = new Set(year.plays.filter((p) => (p.at ?? 0) < start).map((p) => p.key));
    for (const t of s.discoveries!.top) expect(before.has(t.key)).toBe(false);
  });

  it("yearly journey and loyalty", () => {
    const y = { kind: "year" as const, year: 2026 };
    const yp = playsIn(year.plays, periodStart(y), periodEnd(y));
    const ys = computeStats(input(yp, { kind: "year", firstDay: D(2026, 0, 1), lastDay: D(2026, 10, 30) }));
    expect(ys.journey).toHaveLength(11);
    expect(ys.journey!.reduce((a, m) => a + m.plays, 0)).toBe(yp.length);
    expect(ys.artistLoyalty!.months).toBeGreaterThanOrEqual(3);
    expect(ys.milestones.map((m) => m.n)).toEqual(MILESTONES.filter((x) => x <= yp.length));
  });
});

describe("computeStats rules", () => {
  const d = D(2026, 9, 5);

  it("streaks, busiest day and repeat champion", () => {
    const plays = [play("A", "X", d), play("A", "X", d), play("A", "X", d), play("B", "Y", d + 1), play("B", "Y", d + 2), play("C", "Y", d + 4)];
    const s = computeStats(input(plays));
    expect(s.longestStreak).toEqual({ days: 3, from: d, to: d + 2 });
    expect(s.busiestDay).toMatchObject({ day: d, plays: 3 });
    expect(s.repeatChampion).toMatchObject({ day: d, plays: 3, track: { title: "A" } });
    expect(s.byHour).toBeNull(); // too few timed plays
  });

  it("ties break by listened time, then recency", () => {
    const plays = [play("A", "X", d, 10, { listenedMs: 100 }), play("B", "X", d, 11, { listenedMs: 300 }), play("C", "X", d, 9, { listenedMs: 100 }), play("D", "X", d, 12, { listenedMs: 100 })];
    expect(computeStats(input(plays)).topTracks.map((t) => t.title)).toEqual(["B", "D", "A", "C"]);
  });

  it("a song wins over its music video for what's shown", () => {
    const plays = [play("A", "X", d, 10, { type: "video", videoId: "vid" }), play("A", "X", d, 11, { videoId: "song" })];
    expect(computeStats(input(plays)).topTracks[0]).toMatchObject({ videoId: "song", video: false, plays: 2 });
  });

  it("podcasts only when included", () => {
    const eps = [1, 2, 3].map((i) => play(`Ep${i}`, "Show", d, 8, { type: "episode" }));
    const plays = [...eps, play("A", "X", d)];
    expect(computeStats(input(plays)).plays).toBe(1);
    const s = computeStats(input(plays, { includePodcasts: true }));
    expect(s.podcasts).toMatchObject({ episodes: 3, shows: 1, topShow: "Show" });
    expect(s.topArtists.map((a) => a.name)).toEqual(["X"]); // shows aren't artists
  });

  it("history plays without a day don't make day stats", () => {
    const p = play("A", "X", d, 12, { from: d - 3, to: d + 3, at: null, origin: "youtube", estimated: true });
    const s = computeStats(input([p]));
    expect(s.daysListened).toBe(0);
    expect(s.busiestDay).toBeNull();
    expect(s.estimatedShare).toBe(1);
    expect(s.discoveries).toBeNull(); // nothing earlier to compare with
  });

  it("most skipped needs three skips", () => {
    const skips = [1, 2, 3].map(() => play("S", "X", d, 9, { listenedMs: 2000 }));
    expect(computeStats(input([play("A", "X", d)], { skips })).mostSkipped).toMatchObject({ skips: 3, track: { title: "S" } });
    expect(computeStats(input([play("A", "X", d)], { skips: skips.slice(1) })).mostSkipped).toBeNull();
  });

  it("comparison with the previous period", () => {
    const prev = Array.from({ length: 10 }, (_, i) => play(`P${i}`, "X", d - 30));
    const now = Array.from({ length: 15 }, (_, i) => play(`N${i}`, "X", d));
    expect(computeStats(input(now, { previous: prev })).comparison).toMatchObject({ prevPlays: 10, deltaPct: 50 });
    expect(computeStats(input(now, { previous: prev.slice(1) })).comparison).toBeNull();
  });
});

describe("personas", () => {
  const d = D(2026, 9, 5);
  it("are chosen by fixed rules", () => {
    const loyal = Array.from({ length: 40 }, (_, i) => play(`T${i % 4}`, i < 30 ? "X" : `Y${i}`, d + (i % 7)));
    expect(computeStats(input(loyal)).persona.id).toBe("loyalist");
    const night = Array.from({ length: 40 }, (_, i) => play(`T${i}`, `A${i % 10}`, d + (i % 7), i % 2 ? 23 : 1));
    expect(computeStats(input(night)).persona.id).toBe("nightOwl");
    const varied = Array.from({ length: 12 }, (_, i) => play(`T${i}`, `A${i}`, d + i, 14));
    const s = computeStats(input(varied));
    expect(s.persona.id).toBe("eclectic");
    expect(personaOf(s, varied)).toEqual(s.persona);
  });
  it("every persona line is friendly and filled in", () => {
    const s = computeStats(input([play("A", "X", d)]));
    expect(s.persona.line).not.toMatch(/undefined|NaN/);
  });
});

describe("eligibility", () => {
  it("nothing is eligible without data except the persona", () => {
    const s = computeStats(input([]));
    const on = Object.entries(ELIGIBLE).filter(([, f]) => f(s)).map(([k]) => k);
    expect(on).toEqual(["persona"]);
  });
});

// Keeps the synthetic generator honest: invented names only, the same output for the same seed.
describe("synthetic history", () => {
  it("is deterministic and plausible", () => {
    const a = syntheticLog(2026, D(2026, 0, 31));
    expect(syntheticLog(2026, D(2026, 0, 31))).toEqual(a);
    expect(a.length).toBeGreaterThan(100);
    expect(a.every((e: PlayEntry) => e.startedAt >= startOfDay(D(2026, 0, 1)))).toBe(true);
  });
});
