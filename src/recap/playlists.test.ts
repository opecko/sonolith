import { describe, expect, it } from "vitest";
import { dayFromYmd as D, startOfDay } from "./days";
import { mergePlays } from "./merge";
import { periodEnd, type Period } from "./periods";
import { asTrack, dedupe, playlistGone, playlistDescription, playlistTitle, selectTracks } from "./playlists";
import { buildSnapshot } from "./snapshot";
import type { TrackStat } from "./stats";
import { syntheticLog } from "./synthetic";

const data = mergePlays(syntheticLog(2026, D(2026, 11, 31)), []);
const oct: Period = { kind: "month", year: 2026, month: 9 };
const y: Period = { kind: "year", year: 2026 };
const ms = buildSnapshot(oct, data, periodEnd(oct), startOfDay(D(2026, 10, 2)), { frozen: true, podcasts: false, youtube: false }).stats;
const ys = buildSnapshot(y, data, periodEnd(y), startOfDay(D(2026, 11, 2)), { frozen: true, podcasts: false, youtube: false }).stats;

const ts = (key: string, videoId: string, plays = 1): TrackStat => ({ key, videoId, title: key, artist: "A", artistId: null, album: null, video: false, plays, listenedMs: 1, lastAt: 0, bestDay: 1 });

describe("recap playlists", () => {
  it("sizes", () => {
    expect(selectTracks("top", ms, oct)).toHaveLength(Math.min(30, ms.rankedTracks.length));
    expect(selectTracks("top", ys, y).length).toBe(Math.min(100, ys.rankedTracks.length));
  });

  it("top songs keep the stats' order", () => {
    expect(selectTracks("top", ms, oct).map((t) => t.key)).toEqual(ms.rankedTracks.slice(0, 30).map((t) => t.key));
  });

  it("discoveries are new and on repeat really repeated", () => {
    const d = selectTracks("discoveries", ms, oct);
    expect(d.length).toBeGreaterThan(0);
    expect(d.map((t) => t.key)).toEqual(ms.discoveries!.top.slice(0, 25).map((t) => t.key));
    const r = selectTracks("onRepeat", ms, oct);
    expect(r.every((t) => t.bestDay >= 2)).toBe(true);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].bestDay).toBeGreaterThanOrEqual(r[i].bestDay);
  });

  it("dedupes by identity and by video id", () => {
    expect(dedupe([ts("a", "1"), ts("a", "2"), ts("b", "1"), ts("c", "3")]).map((t) => t.key)).toEqual(["a", "c"]);
  });

  it("titles and tracks", () => {
    expect(playlistTitle("top", oct)).toBe("Top songs · October 2026");
    expect(playlistDescription(y)).toBe("Made by Sonolith from my listening in 2026");
    expect(asTrack(ts("x", "vid"))).toMatchObject({ type: "track", id: "vid", artists: ["A"] });
  });

  it("forgets a saved playlist only when it's really gone", () => {
    expect(playlistGone(new Error("This playlist does not exist."))).toBe(true);
    expect(playlistGone(new Error("Request failed with status 404"))).toBe(true);
    expect(playlistGone(new Error("error sending request for url (https://music.youtube.com/…)"))).toBe(false);
    expect(playlistGone(new Error("Sign in to see this"))).toBe(false);
  });
});
