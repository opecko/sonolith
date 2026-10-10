import { describe, expect, it } from "vitest";
import { contrast } from "./color";
import { coverAccentTokens, dominantColor } from "./coverColor";

const pixels = (...runs: [number, [number, number, number]][]) =>
  new Uint8ClampedArray(runs.flatMap(([n, [r, g, b]]) => Array.from({ length: n }, () => [r, g, b, 255]).flat()));

describe("cover accent", () => {
  it("prefers a vivid color over a larger gray area", () => {
    expect(dominantColor(pixels([800, [128, 128, 128]], [200, [220, 30, 40]]))).toBe("#dc1e28");
  });

  it("falls back to the common color of gray artwork, null for no pixels", () => {
    expect(dominantColor(pixels([10, [90, 90, 90]]))).toBe("#5a5a5a");
    expect(dominantColor(new Uint8ClampedArray())).toBeNull();
  });

  it("keeps the accent visible on the background and picks readable text", () => {
    const t = coverAccentTokens("#101820", "#0b0e14", "#ffffff");
    expect(contrast(t.accent!, "#0b0e14")).toBeGreaterThanOrEqual(3);
    const other = t["on-accent"] === "#ffffff" ? "#000000" : "#ffffff";
    expect(contrast(t["on-accent"]!, t.accent!)).toBeGreaterThanOrEqual(contrast(other, t.accent!));
    expect(coverAccentTokens("#e03030", "#030303", "#ffffff").accent).toBe("#e03030");
  });
});
