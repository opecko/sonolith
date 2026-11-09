import { describe, expect, it } from "vitest";
import type { Track } from "../api/types";
import { trackToAnnounce } from "./trackNote";

const track = { id: "a", title: "Song", artists: ["Artist"] } as unknown as Track;
const base = { enabled: true, track, playing: true, focused: false };

describe("song change notifications", () => {
  it("announce a new song that plays while the window isn't focused", () => {
    expect(trackToAnnounce(base, null)).toBe(track);
    expect(trackToAnnounce(base, "b")).toBe(track);
  });

  it("stay quiet when off, focused, not playing yet, or already announced", () => {
    expect(trackToAnnounce({ ...base, enabled: false }, null)).toBeNull();
    expect(trackToAnnounce({ ...base, focused: true }, null)).toBeNull();
    expect(trackToAnnounce({ ...base, playing: false }, null)).toBeNull();
    expect(trackToAnnounce({ ...base, track: undefined }, null)).toBeNull();
    expect(trackToAnnounce(base, "a")).toBeNull();
  });
});
