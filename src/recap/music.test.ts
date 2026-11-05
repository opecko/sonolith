import { describe, expect, it } from "vitest";
import { fade, musicTracks, songFor, startAt } from "./music";
import type { TrackStat } from "./stats";

describe("recap music", () => {
  it("splits the story into equal stretches, one song each", () => {
    expect(Array.from({ length: 12 }, (_, i) => songFor(i, 12, 3))).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(Array.from({ length: 5 }, (_, i) => songFor(i, 5, 2))).toEqual([0, 0, 0, 1, 1]);
    expect(songFor(7, 10, 1)).toBe(0);
    expect(songFor(0, 1, 3)).toBe(0);
  });
  it("starts past the intro and fades smoothly", () => {
    expect(startAt(200)).toBe(60);
    expect(startAt(45)).toBe(0);
    expect(startAt(NaN)).toBe(0);
    expect(fade(0, 0.8)).toEqual({ out: 0.8, in: 0 });
    expect(fade(1, 0.8)).toEqual({ out: 0, in: 0.8 });
    expect(fade(0.5, 1).in).toBeCloseTo(0.5);
  });
  it("takes the top three songs", () => {
    const t = (k: string) => ({ key: k }) as TrackStat;
    expect(musicTracks([t("a"), t("b"), t("c"), t("d")]).map((x) => x.key)).toEqual(["a", "b", "c"]);
  });
});
