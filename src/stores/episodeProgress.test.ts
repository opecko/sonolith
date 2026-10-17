import { describe, expect, it } from "vitest";
import { mark, MAX_ENTRIES, progressFor, record, resumeAt } from "./episodeProgress";

describe("episode progress (local)", () => {
  it("records a position and resumes a little before it", () => {
    const m = record({}, "a", 600, 3600, 1);
    expect(m.a).toMatchObject({ pos: 600, dur: 3600, played: false });
    expect(resumeAt(m.a)).toBe(597);
  });

  it("near the end counts as played, and played episodes start over", () => {
    const m = record({}, "a", 3580, 3600, 1);
    expect(m.a.played).toBe(true);
    expect(resumeAt(m.a)).toBe(0);
  });

  it("barely started or no entry: from the beginning", () => {
    expect(resumeAt(record({}, "a", 5, 3600, 1).a)).toBe(0);
    expect(resumeAt(undefined)).toBe(0);
  });

  it("mark as played / unplayed by hand", () => {
    const played = mark({}, "a", true, 1200, 1);
    expect(played.a).toMatchObject({ played: true, pos: 1200 });
    const unplayed = mark(played, "a", false, 0, 2);
    expect(unplayed.a).toMatchObject({ played: false, pos: 0, dur: 1200 });
  });

  it("list progress: local entry wins, server progress otherwise", () => {
    const server = { percent: 10, text: "50 min left", played: false };
    expect(progressFor(undefined, server)).toBe(server);
    expect(progressFor({ pos: 1800, dur: 3600, played: false, at: 1 }, server)).toEqual({ percent: 50, text: "30 min left", played: false });
    expect(progressFor({ pos: 3600, dur: 3600, played: true, at: 1 }, server)).toEqual({ percent: 100, text: "Played", played: true });
  });

  it("keeps only the most recent entries", () => {
    let m = {};
    for (let i = 0; i < MAX_ENTRIES + 20; i++) m = record(m, `e${i}`, 100, 1000, i);
    expect(Object.keys(m)).toHaveLength(MAX_ENTRIES);
    expect("e0" in m).toBe(false);
    expect(`e${MAX_ENTRIES + 19}` in m).toBe(true);
  });

  it("ignores garbage", () => {
    expect(record({}, "", 1, 2, 1)).toEqual({});
    expect(record({}, "a", 1, 0, 1)).toEqual({});
  });
});
