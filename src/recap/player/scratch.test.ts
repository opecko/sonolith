import { describe, expect, it } from "vitest";
import { SCRATCH_REVEAL, scratchedShare } from "./styles/print";

/** RGBA pixels: `clear` of `n` transparent. */
const px = (n: number, clear: number) => {
  const a = new Uint8ClampedArray(n * 4).fill(255);
  for (let i = 0; i < clear; i++) a[i * 4 + 3] = 0;
  return a;
};

describe("scratch card", () => {
  it("measures the scratched share and opens only from 85 %", () => {
    expect(scratchedShare(px(1000, 0))).toBe(0);
    expect(scratchedShare(px(1000, 1000))).toBe(1);
    expect(scratchedShare(px(1000, 500))).toBeCloseTo(0.5, 1);
    expect(scratchedShare(px(1000, 800)) >= SCRATCH_REVEAL).toBe(false);
    expect(scratchedShare(px(1000, 900)) >= SCRATCH_REVEAL).toBe(true);
  });
});
