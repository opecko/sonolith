import { describe, expect, it } from "vitest";
import { isOwnPlaylist } from "./ownership";

const owners = ["opecko", "@opecko-1"];

describe("isOwnPlaylist", () => {
  it("counts a playlist with just a count as own", () => {
    expect(isOwnPlaylist({ id: "PL1", subtitle: "7 tracks" }, [])).toBe(true);
    expect(isOwnPlaylist({ id: "PL1", subtitle: "Playlist" }, [])).toBe(true);
  });

  it("counts the account as author as own (brand channels), by name or handle", () => {
    expect(isOwnPlaylist({ id: "PL2", subtitle: "opecko • 0 tracks" }, owners)).toBe(true);
    expect(isOwnPlaylist({ id: "PL2", subtitle: "Opecko • 3 tracks" }, owners)).toBe(true);
    expect(isOwnPlaylist({ id: "PL2", subtitle: "opecko-1 • 3 tracks" }, owners)).toBe(true);
  });

  it("leaves out others' playlists, auto playlists and the special ones", () => {
    expect(isOwnPlaylist({ id: "PL3", subtitle: "Enderman • 119 tracks" }, owners)).toBe(false);
    expect(isOwnPlaylist({ id: "PL3", subtitle: "Enderman • 119 tracks" }, [])).toBe(false);
    expect(isOwnPlaylist({ id: "PL4", subtitle: "YouTube Music" }, owners)).toBe(false);
    expect(isOwnPlaylist({ id: "PL5", subtitle: "Auto playlist • 7 episodes" }, owners)).toBe(false);
    expect(isOwnPlaylist({ id: "LM", subtitle: "Auto playlist" }, owners)).toBe(false);
    expect(isOwnPlaylist({ id: "SE", subtitle: "Your queued episodes" }, owners)).toBe(false);
    expect(isOwnPlaylist({ id: "RDCLAK", subtitle: "12 tracks" }, owners)).toBe(false);
  });
});
