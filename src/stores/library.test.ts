import { describe, expect, it } from "vitest";
import { countedSubtitle } from "./library";

describe("countedSubtitle", () => {
  it("adjusts YouTube's track count", () => {
    expect(countedSubtitle("7 tracks", 1)).toBe("8 tracks");
    expect(countedSubtitle("1 track", 1)).toBe("2 tracks");
    expect(countedSubtitle("2 tracks", -1)).toBe("1 track");
    expect(countedSubtitle("1,204 tracks", 1)).toBe("1,205 tracks");
    expect(countedSubtitle("0 tracks", -1)).toBe("0 tracks");
  });
  it("starts a just-created playlist at zero and leaves other subtitles alone", () => {
    expect(countedSubtitle("Playlist", 1)).toBe("1 track");
    expect(countedSubtitle("Someone • 12 tracks", 1)).toBe("Someone • 12 tracks");
  });
});
