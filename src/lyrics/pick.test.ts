import { describe, expect, it } from "vitest";
import { chooseLyrics, lineAt, pickWinner, tierOf, type LyricsData } from "./pick";

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

describe("quality tiers", () => {
  it("word timings make lyrics word-synced", () => {
    expect(tierOf({ synced: true, lines: [{ start: 0, text: "a", words: [{ start: 0, end: 1, text: "a" }] }] })).toBe("word-synced");
    expect(tierOf({ synced: true, lines: [{ start: 0, text: "a" }] })).toBe("line-synced");
    expect(tierOf({ synced: false, lines: [] })).toBe("unsynced");
  });
  it("the highest tier wins, then the higher provider", () => {
    const a = (provider: LyricsData["provider"], status: string) => ({ provider, status });
    expect(pickWinner([a("youtube", "line-synced"), a("lrclib", "word-synced")])?.index).toBe(1);
    expect(pickWinner([a("youtube", "word-synced"), a("lrclib", "word-synced")])?.index).toBe(0);
    expect(pickWinner([a("youtube", "unsynced"), a("kugou", "error"), a("lrclib", "line-synced")])?.index).toBe(2);
    expect(pickWinner([a("youtube", "none"), a("lrclib", "timeout")])).toBeNull();
    expect(pickWinner([a("youtube", "line-synced"), a("lrclib", "word-synced")])?.reason).toContain("beats line-synced from youtube");
  });
});
