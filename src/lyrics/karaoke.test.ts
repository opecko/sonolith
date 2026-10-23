import { describe, expect, it } from "vitest";
import { gapPose, gapsOf, LIFT, normalizeKaraoke, wordFill, wordGlow, wordLift } from "./karaoke";

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

describe("instrumental breaks", () => {
  it("are found where the gap between lines is long enough and the line end is known", () => {
    const lines = [
      { start: 8000, end: 10000, text: "a" },
      { start: 11000, text: "b", words: [{ start: 11000, end: 12000, text: "b" }] },
      { start: 20000, text: "c" },
      { start: 40000, text: "d" },
    ];
    // Before the first line, after "b" (its last word ends at 12 s); "c" has no end, so nothing after it.
    expect(gapsOf(lines)).toEqual([[0, 0, 8000], [2, 12000, 20000]]);
    expect(gapsOf(lines, 9000)).toEqual([]);
  });
  it("light the dots one by one before the exit", () => {
    // 6 s break: the exit takes the last 450 ms, so the dots are lit over 5550 ms.
    expect(gapPose(0, 6000, 0, true).dots).toEqual([0, 0, 0]);
    expect(gapPose(0, 6000, 2775, true).dots).toEqual([1, 0.5, 0]);
    expect(gapPose(0, 6000, 5550, true).dots).toEqual([1, 1, 1]);
    expect(gapPose(0, 6000, 6000, false)).toEqual({ dots: [1, 1, 1], scale: 1, opacity: 1 });
  });
  it("pop in, breathe, swell and vanish", () => {
    const at = (ms: number) => gapPose(0, 6000, ms, true);
    expect(at(0)).toMatchObject({ scale: 0, opacity: 0 });
    expect(at(400).opacity).toBe(1);
    // Smallest breath right where the exit starts, then the swell, then gone.
    expect(at(5550).scale).toBeCloseTo(0.85, 5);
    expect(at(5550 + 0.35 * 450).scale).toBeCloseTo(1.2, 5);
    expect(at(5999).scale).toBeLessThan(0.01);
    expect(at(5999).opacity).toBeLessThan(0.01);
    // Breathing stays between small and big.
    for (let ms = 400; ms < 5550; ms += 97) {
      const s = at(ms).scale;
      expect(s).toBeGreaterThan(0.84);
      expect(s).toBeLessThan(1.13);
    }
  });
});
