import { describe, expect, it } from "vitest";
import type { Track } from "../api/types";
import { countsAsPlay, monthKey, parseLog, PlayTracker, sourceOf, trackInfo, type TrackInfo } from "./playLog";

const info = (videoId = "a", durationMs = 200_000): TrackInfo => ({
  videoId, type: "song", title: `T ${videoId}`, artists: [{ id: "UC1", name: "Artist" }], album: null, durationMs,
});

/** Plays from `from` to `to` seconds in 250 ms timeupdates starting at wall time `t0`; returns written entries. */
function play(tr: PlayTracker, from: number, to: number, t0: number) {
  const out = [];
  for (let p = from + 0.25; p <= to + 1e-9; p += 0.25) {
    const e = tr.tick(p, t0 + (p - from) * 1000);
    if (e) out.push(e);
  }
  return out;
}

describe("PlayTracker", () => {
  it("records a play once it passes the threshold and finishes it on track change", () => {
    const tr = new PlayTracker(() => "id1");
    tr.track(info(), 0);
    tr.playing(0, 0);
    const written = play(tr, 0, 12, 0);
    expect(written).toHaveLength(1); // crossing 10 s
    expect(written[0].listenedMs).toBe(10_000);
    const last = tr.track(info("b"), 13_000)!;
    expect(last.id).toBe("id1");
    expect(last.listenedMs).toBe(12_000);
    expect(last.skipped).toBeUndefined();
    expect(last.completed).toBe(false);
  });

  it("keeps a skip below the threshold as a skipped entry", () => {
    const tr = new PlayTracker();
    tr.track(info(), 0);
    tr.playing(0, 0);
    play(tr, 0, 4, 0);
    const e = tr.track(info("b"), 5000)!;
    expect(e.skipped).toBe(true);
    expect(e.listenedMs).toBe(4000);
  });

  it("writes nothing for a track that never started playing", () => {
    const tr = new PlayTracker();
    tr.track(info(), 0);
    expect(tr.track(info("b"), 100)).toBeNull();
  });

  it("doesn't count paused time", () => {
    const tr = new PlayTracker();
    tr.track(info(), 0);
    tr.playing(0, 0);
    play(tr, 0, 5, 0);
    tr.paused(5, 5000);
    // An hour later it resumes; the first timeupdate after resuming must not count the pause.
    tr.playing(5, 3_605_000);
    tr.tick(5.25, 3_605_250);
    expect(tr.track(null, 3_606_000)!.listenedMs).toBe(5250);
  });

  it("doesn't count the range jumped over by a seek", () => {
    const tr = new PlayTracker();
    tr.track(info(), 0);
    tr.playing(0, 0);
    play(tr, 0, 20, 0);
    tr.seeking();
    tr.seeked(150, 20_100, false);
    play(tr, 150, 160, 20_100);
    expect(tr.track(null, 31_000)!.listenedMs).toBe(30_000);
  });

  it("treats a jump without seek events as no listening", () => {
    const tr = new PlayTracker();
    tr.track(info(), 0);
    tr.playing(0, 0);
    play(tr, 0, 12, 0);
    tr.tick(100, 12_250); // 88 s in a quarter of a second
    expect(tr.track(null, 13_000)!.listenedMs).toBe(12_000);
  });

  it("resumes counting after a seek only if the element still plays", () => {
    const tr = new PlayTracker();
    tr.track(info(), 0);
    tr.playing(0, 0);
    play(tr, 0, 12, 0);
    tr.paused(12, 12_000);
    tr.seeking();
    tr.seeked(50, 13_000, true);
    tr.tick(51, 14_000); // no playing event yet: not counted
    tr.playing(51, 14_000);
    tr.tick(52, 15_000);
    expect(tr.track(null, 16_000)!.listenedMs).toBe(13_000);
  });

  it("marks a play that ended as completed and starts a new one on repeat", () => {
    let n = 0;
    const tr = new PlayTracker(() => `p${n++}`);
    tr.track(info("a", 20_000), 0);
    tr.playing(0, 0);
    play(tr, 0, 20, 0);
    const end = tr.ended(20, 20_000)!;
    expect(end).toMatchObject({ id: "p0", completed: true, listenedMs: 20_000 });
    tr.playing(0, 21_000);
    play(tr, 0, 11, 21_000);
    const again = tr.track(null, 40_000)!;
    expect(again.id).toBe("p1");
    expect(again.listenedMs).toBe(11_000);
  });

  it("counts half of a short track", () => {
    const tr = new PlayTracker();
    tr.track(info("a", 8000), 0);
    tr.playing(0, 0);
    expect(play(tr, 0, 4, 0)).toHaveLength(1);
  });

  it("checkpoints every 30 s while playing", () => {
    const tr = new PlayTracker();
    tr.track(info(), 0);
    tr.playing(0, 0);
    const written = play(tr, 0, 75, 0);
    expect(written.map((e) => e.listenedMs)).toEqual([10_000, 40_000, 70_000]);
  });

  it("flushes a counted play when the window hides and keeps counting", () => {
    const tr = new PlayTracker();
    tr.track(info(), 0);
    tr.playing(0, 0);
    play(tr, 0, 15, 0);
    expect(tr.hidden(15, 15_000, false)!.listenedMs).toBe(15_000);
    play(tr, 15, 20, 15_000);
    expect(tr.track(null, 21_000)!.listenedMs).toBe(20_000);
  });

  it("writes the current play on quit, but never a skip", () => {
    const tr = new PlayTracker();
    tr.track(info(), 0);
    tr.playing(0, 0);
    play(tr, 0, 15, 0);
    expect(tr.quit(15, 15_000, false)).toMatchObject({ listenedMs: 15_000 });
    const t2 = new PlayTracker();
    t2.track(info(), 0);
    t2.playing(0, 0);
    play(t2, 0, 3, 0);
    expect(t2.quit(3, 3000, false)).toBeNull();
  });

  it("takes the element's real duration", () => {
    const tr = new PlayTracker();
    tr.track(info("a", 0), 0);
    tr.duration(180.5);
    tr.playing(0, 0);
    play(tr, 0, 12, 0);
    expect(tr.track(null, 13_000)!.durationMs).toBe(180_500);
  });
});

describe("helpers", () => {
  it("countsAsPlay", () => {
    expect(countsAsPlay(9.9, 200)).toBe(false);
    expect(countsAsPlay(10, 200)).toBe(true);
    expect(countsAsPlay(3, 6)).toBe(true);
    expect(countsAsPlay(10, 0)).toBe(true);
  });

  it("trackInfo and sourceOf", () => {
    const t: Track = { type: "track", id: "v", title: "x", subtitle: "", artists: ["A", "B"], artistIds: ["UCa"], album: { title: "Al" }, durationSec: 61, video: true };
    expect(trackInfo(t)).toMatchObject({ type: "video", artists: [{ id: "UCa", name: "A" }, { id: null, name: "B" }], album: { id: null, title: "Al" }, durationMs: 61_000 });
    expect(sourceOf(t, "RDAMVMx")).toBe("radio");
    expect(sourceOf(t, "OLAK5uy_x")).toBe("album");
    expect(sourceOf(t, "PLx")).toBe("playlist");
    expect(sourceOf(t, undefined)).toBe("queue");
    expect(sourceOf({ ...t, source: "autoplay" }, "PLx")).toBe("autoplay");
  });

  it("monthKey is local time", () => {
    expect(monthKey(new Date(2026, 0, 31, 23, 59).getTime())).toBe("2026-01");
  });
});

describe("parseLog", () => {
  const line = (o: object) => JSON.stringify({ videoId: "v", title: "t", artists: [], album: null, durationMs: 1, listenedMs: 1, completed: false, type: "song", ...o });

  it("lets later lines with the same id win and sorts by start", () => {
    const text = [line({ id: "b", startedAt: 20, listenedMs: 5 }), line({ id: "a", startedAt: 10 }), line({ id: "b", startedAt: 20, listenedMs: 9 })].join("\n");
    expect(parseLog(text).map((e) => [e.id, e.listenedMs])).toEqual([["a", 1], ["b", 9]]);
  });

  it("tolerates a torn last line and junk", () => {
    const text = `${line({ id: "a", startedAt: 1 })}\nnot json\n{"id":3}\n${line({ id: "b", startedAt: 2 }).slice(0, 20)}`;
    expect(parseLog(text).map((e) => e.id)).toEqual(["a"]);
  });
});
