import { describe, expect, it } from "vitest";
import type { Track } from "../api/types";
import { playlistTitle, pushRecent, queueTitle, readRecent, recentFrom, replaced, RECENT_MAX } from "./recentQueues";

const t = (id: string): Track => ({ type: "track", id, title: `Song ${id}`, artists: ["A"], menu: { x: 1 } } as unknown as Track);
const q = (...ids: string[]) => ids.map(t);

describe("recent queues", () => {
  it("keeps queues of two songs or more, without menu tokens or a radio continuation", () => {
    expect(recentFrom(q("a"), 0, {}, 1)).toBeNull();
    const r = recentFrom(q("a", "b", "c"), 1, { title: "Mix", continuation: "x", autoplay: true, playlistId: "PL1" }, 5)!;
    expect(r).toMatchObject({ title: "Mix", savedAt: 5, index: 1, context: { title: "Mix", playlistId: "PL1" } });
    expect(r.context).not.toHaveProperty("continuation");
    expect(r.tracks[0]).not.toHaveProperty("menu");
  });

  it("trims a long queue around the song that was playing", () => {
    const long = Array.from({ length: 500 }, (_, i) => t(String(i)));
    const r = recentFrom(long, 400, {}, 0)!;
    expect(r.tracks).toHaveLength(200);
    expect(r.tracks[r.index].id).toBe("400");
  });

  it("names a queue without a title by its first song", () => {
    expect(queueTitle(q("a", "b", "c"), {})).toBe("Song a and 2 more");
    expect(queueTitle(q("a"), {})).toBe("Song a");
  });

  it("puts the newest first, replaces the same queue, keeps at most five", () => {
    const mk = (title: string, ...ids: string[]) => recentFrom(q(...ids), 0, { title }, 0)!;
    let list = pushRecent([], mk("A", "1", "2"));
    list = pushRecent(list, mk("B", "3", "4"));
    list = pushRecent(list, mk("A", "1", "2"));
    expect(list.map((x) => x.title)).toEqual(["A", "B"]);
    for (let i = 0; i < 10; i++) list = pushRecent(list, mk(`Q${i}`, `${i}a`, `${i}b`));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].title).toBe("Q9");
  });

  it("reads only well-formed stored queues", () => {
    const good = recentFrom(q("a", "b"), 0, {}, 1)!;
    expect(readRecent(JSON.stringify([good, { title: "x" }, null]))).toEqual([good]);
    expect(readRecent("not json")).toEqual([]);
    expect(readRecent(null)).toEqual([]);
  });

  it("a queue counts as replaced only when the playing song left it", () => {
    const a = q("a", "b", "c");
    expect(replaced(a, 1, q("x", "y"))).toBe(true);
    expect(replaced(a, 1, [...a, t("d")])).toBe(false);
    expect(replaced(a, 1, q("c", "b", "a"))).toBe(false);
    expect(replaced(a, -1, q("x"))).toBe(false);
  });

  it("names a playlist after the queue or the date", () => {
    expect(playlistTitle({ title: "Chill" }, new Date(2026, 10, 9))).toBe("Chill");
    expect(playlistTitle({}, new Date(2026, 10, 9))).toBe("Queue, 9 Nov 2026");
  });
});
