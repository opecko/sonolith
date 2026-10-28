import { describe, expect, it } from "vitest";
import { fadeGains, fadeLength, shouldPrepare, shouldStartFade } from "./crossfade";

const song = { crossfade: 6, duration: 200, eligible: true };

describe("shouldPrepare", () => {
  it("prepares the next song from 80 % on, or seeking there", () => {
    expect(shouldPrepare({ ...song, position: 150 })).toBe(false);
    expect(shouldPrepare({ ...song, position: 160 })).toBe(true);
    expect(shouldPrepare({ ...song, position: 190 })).toBe(true);
  });

  it("prepares early enough for short songs", () => {
    expect(shouldPrepare({ ...song, duration: 60, position: 35 })).toBe(true); // 80 % would be 48 s
  });

  it("never with crossfade off, for episodes / live / repeat one, or without a length", () => {
    expect(shouldPrepare({ ...song, crossfade: 0, position: 190 })).toBe(false);
    expect(shouldPrepare({ ...song, eligible: false, position: 190 })).toBe(false);
    expect(shouldPrepare({ ...song, duration: Infinity, position: 190 })).toBe(false);
    expect(shouldPrepare({ ...song, duration: 0, position: 0 })).toBe(false);
  });
});

describe("shouldStartFade", () => {
  it("starts the fade its length before the end", () => {
    expect(shouldStartFade({ ...song, position: 193 })).toBe(false);
    expect(shouldStartFade({ ...song, position: 194.1 })).toBe(true);
  });

  it("keeps the fade within a third of a short song", () => {
    expect(fadeLength(12, 15)).toBe(5);
    expect(shouldStartFade({ ...song, crossfade: 12, duration: 15, position: 9 })).toBe(false);
    expect(shouldStartFade({ ...song, crossfade: 12, duration: 15, position: 10.5 })).toBe(true);
  });

  it("doesn't fade tiny clips or when off", () => {
    expect(shouldStartFade({ ...song, duration: 1, position: 0.9 })).toBe(false);
    expect(shouldStartFade({ ...song, crossfade: 0, position: 199 })).toBe(false);
  });
});

describe("fadeGains", () => {
  it("goes from all out to all in with even power", () => {
    expect(fadeGains(0)).toEqual({ out: 1, in: 0 });
    const end = fadeGains(1);
    expect(end.out).toBeCloseTo(0);
    expect(end.in).toBeCloseTo(1);
    const mid = fadeGains(0.5);
    expect(mid.out ** 2 + mid.in ** 2).toBeCloseTo(1);
    expect(fadeGains(2)).toEqual(fadeGains(1));
  });
});
