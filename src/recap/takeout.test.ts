import { describe, expect, it } from "vitest";
import { EMPTY_TAKEOUT, mergeTakeout, parseTakeout, parseTakeoutCache } from "./takeout";

// Synthetic entries in Takeout's watch-history.json shape (invented titles and ids).
const entry = (o: Record<string, unknown>) => ({
  header: "YouTube Music",
  title: "Watched Glass River",
  titleUrl: "https://music.youtube.com/watch?v=abcdefghijk",
  subtitles: [{ name: "Synthetic Band - Topic", url: "https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa" }],
  time: "2026-10-12T18:23:45.123Z",
  products: ["YouTube"],
  activityControls: ["YouTube watch history"],
  ...o,
});

describe("parseTakeout", () => {
  it("reads YouTube Music plays and leaves out YouTube ones", () => {
    const text = JSON.stringify([
      entry({}),
      entry({ time: "2026-10-12T19:00:00Z" }),
      entry({ header: "YouTube", title: "Watched a cat video", titleUrl: "https://www.youtube.com/watch?v=zzzzzzzzzzz" }),
      entry({ title: "Zhlédnuto: Paper Hearts", titleUrl: "https://music.youtube.com/watch?v=bbbbbbbbbbb", subtitles: undefined }),
    ]);
    const r = parseTakeout(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.youtubeOnly).toBe(1);
    expect(r.plays).toHaveLength(3);
    expect(r.plays[0]).toEqual({ videoId: "abcdefghijk", title: "Glass River", artist: "Synthetic Band", artistId: "UCaaaaaaaaaaaaaaaaaaaaaa", at: Date.parse("2026-10-12T18:23:45.123Z") });
    expect(r.plays.find((p) => p.videoId === "bbbbbbbbbbb")).toMatchObject({ title: "Paper Hearts", artist: "", artistId: null });
  });

  it("skips removed videos and junk without throwing", () => {
    const r = parseTakeout(JSON.stringify([entry({ titleUrl: undefined, title: "Watched a video that has been removed" }), entry({ time: "not a date" }), null, 5, { foo: 1 }, entry({})]));
    expect(r.ok && r.plays.length).toBe(1);
    expect(r.ok && r.skipped).toBe(5);
  });

  it("tells HTML and other files apart", () => {
    expect(parseTakeout("<!DOCTYPE html><html>…")).toEqual({ ok: false, reason: "html" });
    expect(parseTakeout("{\"a\":1}")).toEqual({ ok: false, reason: "notHistory" });
    expect(parseTakeout("[1,2]")).toEqual({ ok: false, reason: "notHistory" });
    expect(parseTakeout("garbage")).toEqual({ ok: false, reason: "notHistory" });
  });
});

describe("takeout cache", () => {
  it("re-importing the same export adds nothing", () => {
    const r = parseTakeout(JSON.stringify([entry({}), entry({ time: "2026-10-13T08:00:00Z" })]));
    if (!r.ok) throw new Error();
    const a = mergeTakeout(EMPTY_TAKEOUT, r.plays, 1);
    const b = mergeTakeout(a, r.plays, 2);
    expect(b.plays).toHaveLength(2);
    expect(b.importedAt).toBe(2);
    expect(parseTakeoutCache(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(parseTakeoutCache({ version: 2 })).toBe(EMPTY_TAKEOUT);
  });
});
