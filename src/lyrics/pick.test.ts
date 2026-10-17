import { describe, expect, it } from "vitest";
import { chooseLyrics, lineAt, type LyricsData } from "./pick";

const synced = (provider: LyricsData["provider"]): LyricsData => ({ provider, synced: true, lines: [{ start: 0, text: "a" }] });
const plain = (provider: LyricsData["provider"]): LyricsData => ({ provider, synced: false, lines: [], plain: "a" });
const order = ["youtube", "betterlyrics", "lrclib"] as const;

describe("choosing between providers and YouTube Music's plain lyrics", () => {
  it("synced lyrics from a provider always win", () => {
    expect(chooseLyrics(synced("lrclib"), plain("youtube"), [...order])?.provider).toBe("lrclib");
  });
  it("between unsynced ones the higher provider wins", () => {
    expect(chooseLyrics(plain("lrclib"), plain("youtube"), [...order])?.provider).toBe("youtube");
    expect(chooseLyrics(plain("betterlyrics"), plain("youtube"), ["betterlyrics", "youtube"])?.provider).toBe("betterlyrics");
  });
  it("whichever exists", () => {
    expect(chooseLyrics(null, plain("youtube"), [...order])?.provider).toBe("youtube");
    expect(chooseLyrics(plain("lrclib"), null, [...order])?.provider).toBe("lrclib");
    expect(chooseLyrics(null, null, [...order])).toBeNull();
  });
});

describe("current line", () => {
  const lines = [{ start: 1000, text: "a" }, { start: 2000, text: "b" }, { start: 5000, text: "c" }];
  it("is the last line that started", () => {
    expect(lineAt(lines, 0)).toBe(-1);
    expect(lineAt(lines, 1000)).toBe(0);
    expect(lineAt(lines, 4999)).toBe(1);
    expect(lineAt(lines, 99999)).toBe(2);
    expect(lineAt([], 5)).toBe(-1);
  });
});
