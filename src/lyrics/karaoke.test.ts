import { describe, expect, it } from "vitest";
import { LIFT, normalizeKaraoke, wordFill, wordGlow, wordLift } from "./karaoke";

const w = { start: 1000, end: 1500 };

describe("karaoke timing", () => {
  it("sweep fills along the word's timing", () => {
    expect(wordFill(w, 900)).toBe(0);
    expect(wordFill(w, 1250)).toBeCloseTo(0.5);
    expect(wordFill(w, 1600)).toBe(1);
    expect(wordFill({ start: 5, end: 5 }, 5)).toBe(0);
    expect(wordFill({ start: 5, end: 5 }, 6)).toBe(1);
  });
  it("glow comes in fast and fades after the word", () => {
    expect(wordGlow(w, 999)).toBe(0);
    expect(wordGlow(w, 1060)).toBeCloseTo(0.5);
    expect(wordGlow(w, 1400)).toBe(1);
    expect(wordGlow(w, 1500 + 225)).toBeCloseTo(0.5);
    expect(wordGlow(w, 3000)).toBe(0);
  });
  it("bounce lifts while sung and settles back to rest", () => {
    expect(wordLift(w, 900)).toBe(0);
    expect(wordLift(w, 1450)).toBeLessThan(-LIFT * 0.8);
    expect(Math.abs(wordLift(w, 1500 + 590))).toBeLessThan(0.5);
    expect(wordLift(w, 5000)).toBe(0);
  });
  it("unknown stored styles fall back to Sweep", () => {
    expect(normalizeKaraoke("glow")).toBe("glow");
    expect(normalizeKaraoke("wobble")).toBe("sweep");
    expect(normalizeKaraoke(undefined)).toBe("sweep");
  });
});
