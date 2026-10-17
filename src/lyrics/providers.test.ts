import { describe, expect, it } from "vitest";
import { DEFAULT_LYRICS_PROVIDERS, enabledProviders, normalizeLyricsProviders } from "./providers";

describe("lyrics provider settings", () => {
  it("defaults: YouTube Music first, all on", () => {
    expect(normalizeLyricsProviders(undefined)).toEqual(DEFAULT_LYRICS_PROVIDERS);
    expect(enabledProviders(DEFAULT_LYRICS_PROVIDERS)).toEqual(["youtube", "betterlyrics", "unison", "lyricsplus", "kugou", "lrclib"]);
  });

  it("keeps the user's order and switches, drops unknown ones and duplicates, appends new ones", () => {
    const s = normalizeLyricsProviders([
      { id: "lrclib", enabled: true },
      { id: "musixmatch", enabled: true },
      { id: "youtube", enabled: false },
      { id: "lrclib", enabled: false },
      "junk",
    ]);
    expect(s.slice(0, 2)).toEqual([{ id: "lrclib", enabled: true }, { id: "youtube", enabled: false }]);
    expect(s.map((p) => p.id)).toEqual(["lrclib", "youtube", "betterlyrics", "unison", "lyricsplus", "kugou"]);
    expect(enabledProviders(s)[0]).toBe("lrclib");
  });

  it("all off means no providers to ask", () => {
    expect(enabledProviders(DEFAULT_LYRICS_PROVIDERS.map((p) => ({ ...p, enabled: false })))).toEqual([]);
  });
});
