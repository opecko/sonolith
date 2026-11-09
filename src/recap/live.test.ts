import { describe, expect, it } from "vitest";
import { dayFromYmd, dayOf } from "./days";
import { liveStats, windowStart } from "./live";
import type { Play } from "./merge";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();
const play = (title: string, artist: string, when: number | null, over: Partial<Play> = {}): Play => ({
  key: `${title}|${artist}`, videoId: title, type: "song", title, artists: [{ id: null, name: artist }], album: null, durationMs: 200_000,
  from: when === null ? 0 : dayOf(when), to: when === null ? 0 : dayOf(when), at: when, listenedMs: 180_000, estimated: false, completed: true, origin: "log", ...over,
});
const now = at(2026, 10, 9, 18); // Mon 9 Nov 2026

describe("live stats", () => {
  it("windows: today, the last 7 days, this month so far", () => {
    const today = dayOf(now);
    expect(windowStart("today", today)).toBe(today);
    expect(windowStart("week", today)).toBe(today - 6);
    expect(windowStart("month", today)).toBe(dayFromYmd(2026, 10, 1));
  });

  it("counts plays, time and the favourites of each window", () => {
    const plays = [
      play("A", "X", at(2026, 10, 9, 9)), play("A", "X", at(2026, 10, 9, 10)), play("B", "Y", at(2026, 10, 9, 11)),
      play("C", "Y", at(2026, 10, 5)), play("C", "Y", at(2026, 10, 4)),
      play("D", "Z", at(2026, 10, 1)),
      play("E", "Z", at(2026, 9, 31)),
    ];
    const today = liveStats(plays, now, "today");
    expect(today).toMatchObject({ plays: 3, listenedMs: 540_000, topArtist: { name: "X", plays: 2 }, topSong: { title: "A", artist: "X", plays: 2 } });
    const week = liveStats(plays, now, "week");
    expect(week).toMatchObject({ plays: 5, topArtist: { name: "Y", plays: 3 } });
    expect(liveStats(plays, now, "month").plays).toBe(6);
  });

  it("a favourite needs two plays; one-offs and episodes don't count as one", () => {
    const s = liveStats([play("A", "X", at(2026, 10, 9, 9)), play("P", "Show", at(2026, 10, 9, 10), { type: "episode" }), play("P", "Show", at(2026, 10, 9, 11), { type: "episode" })], now, "today");
    expect(s.plays).toBe(3);
    expect(s.topArtist).toBeNull();
    expect(s.topSong).toBeNull();
  });

  it("history plays count only when their day is known exactly; future plays never", () => {
    const d = dayOf(at(2026, 10, 9));
    const plays = [
      play("A", "X", null, { from: d, to: d, origin: "youtube" }),
      play("B", "X", null, { from: d - 3, to: d, origin: "youtube" }),
      play("C", "X", at(2026, 10, 9, 23)),
    ];
    expect(liveStats(plays, now, "today").plays).toBe(1);
  });
});
