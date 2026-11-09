import { describe, expect, it } from "vitest";
import { wantAwake } from "./keepAwake";

describe("keep the screen on", () => {
  it("while something plays or loads to play, when the setting is on", () => {
    expect(wantAwake(true, "playing", true)).toBe(true);
    expect(wantAwake(true, "loading", true)).toBe(true);
    expect(wantAwake(true, "paused", true)).toBe(false);
    expect(wantAwake(true, "error", true)).toBe(false);
    expect(wantAwake(true, "idle", false)).toBe(false);
    expect(wantAwake(false, "playing", true)).toBe(false);
  });
});
