import { describe, expect, it } from "vitest";
import { dayFromYmd as D, dayOf, startOfDay } from "./days";
import { FALLBACK_DURATION_MS, firstDay, mergePlays, trackKey } from "./merge";
import type { PlayEntry, TrackInfo } from "./playLog";
import type { TakeoutPlay } from "./takeout";
import type { HistoryPlay } from "./ytHistory";

const artist = [{ id: "UCsyn", name: "Synthetic Band" }];
const info = (videoId: string, title = "Glass River", extra: Partial<TrackInfo> = {}): TrackInfo => ({ videoId, type: "song", title, artists: artist, album: null, durationMs: 180_000, ...extra });
const logPlay = (id: string, day: number, hour = 12, extra: Partial<PlayEntry> = {}): PlayEntry => ({
  id, ...info("s1"), startedAt: startOfDay(day) + hour * 3_600_000, listenedMs: 170_000, completed: true, ...extra,
});
const hist = (videoId: string, from: number, to = from, t?: TrackInfo): HistoryPlay => ({ videoId, from, to, track: t ?? info(videoId), seenAt: 0 });

describe("trackKey", () => {
  it("joins a song and its music video", () => {
    const song = trackKey("Glass River", artist);
    expect(trackKey("Glass River (Official Video)", artist)).toBe(song);
    expect(trackKey("Synthetic Band - Glass River [Official Music Video]", [{ id: "UCvevo", name: "SyntheticBandVEVO" }])).toBe(song);
    expect(trackKey("Glass River", [{ id: null, name: "Synthetic Band - Topic" }])).toBe(song);
    expect(trackKey("Glass Lake", artist)).not.toBe(song);
  });
});

describe("mergePlays", () => {
  const d = D(2026, 9, 10);

  it("takes the larger count per day and track", () => {
    const m = mergePlays([logPlay("a", d), logPlay("b", d, 15)], [hist("s1", d), hist("v1", d, d, info("v1", "Glass River (Official Video)"))]);
    // 2 local vs 2 from YouTube (song + its video) on the same day → 2.
    expect(m.plays).toHaveLength(2);
    expect(m.plays.every((p) => p.origin === "log")).toBe(true);
  });

  it("adds plays from other devices with an estimated length", () => {
    const m = mergePlays([logPlay("a", d)], [hist("s1", d + 1), hist("x", d + 2, d + 2, info("x", "Other", { durationMs: 0 }))]);
    expect(m.plays.map((p) => [p.origin, p.from])).toEqual([["log", d], ["youtube", d + 1], ["youtube", d + 2]]);
    expect(m.plays[2]).toMatchObject({ estimated: true, listenedMs: FALLBACK_DURATION_MS });
  });

  it("a wide bucket is covered by any local play of the track inside it", () => {
    const m = mergePlays([logPlay("a", d)], [hist("s1", d - 5, d + 5), hist("x", d - 5, d + 5, info("x", "Other"))]);
    expect(m.plays.map((p) => p.title).sort()).toEqual(["Glass River", "Other"]);
    const other = m.plays.find((p) => p.title === "Other")!;
    expect(other.from).not.toBe(other.to);
  });

  it("keeps skips apart", () => {
    const m = mergePlays([logPlay("a", d, 12, { skipped: true, listenedMs: 3000 })], []);
    expect(m.plays).toHaveLength(0);
    expect(m.skips).toHaveLength(1);
  });

  it("days are local", () => {
    const m = mergePlays([logPlay("a", d, 23)], []);
    expect(m.plays[0].from).toBe(dayOf(m.plays[0].at!));
    expect(firstDay(m)).toBe(d);
    expect(firstDay({ plays: [], skips: [] })).toBeNull();
  });

  const tk = (videoId: string, day: number, hour: number, title = "Glass River"): TakeoutPlay => ({ videoId, title, artist: "Synthetic Band", artistId: "UCtopic", at: startOfDay(day) + hour * 3_600_000 });

  it("Takeout adds other devices' plays, never twins of logged ones", () => {
    // Logged at 12:00; Takeout has that play (12:00) plus one at 20:00 from a phone.
    const m = mergePlays([logPlay("a", d, 12)], [], [tk("s1", d, 12), tk("s1", d, 20)]);
    expect(m.plays.map((p) => [p.origin, new Date(p.at!).getHours()])).toEqual([["log", 12], ["takeout", 20]]);
    // The Takeout play borrows the logged song's length and stays marked as estimated.
    expect(m.plays[1]).toMatchObject({ durationMs: 180_000, listenedMs: 180_000, estimated: true });
  });

  it("history plays count only beyond Takeout's on the same day, and its ranges are covered by Takeout", () => {
    const m = mergePlays([], [hist("s1", d), hist("s1", d - 9, d - 3)], [tk("s1", d, 9), tk("s1", d - 5, 9)]);
    expect(m.plays.map((p) => p.origin)).toEqual(["takeout", "takeout"]);
    const more = mergePlays([], [hist("x", d, d, info("x", "Other"))], [tk("s1", d, 9)]);
    expect(more.plays.map((p) => p.origin).sort()).toEqual(["takeout", "youtube"]);
  });
});

