import { describe, expect, it } from "vitest";
import { Hct } from "@material/material-color-utilities";
import { mixTokens, schemeTokens, sourceColor } from "./albumScheme";
import { normalizeAppearance } from "./appearance";
import { contrast, isHex, isLight } from "./color";
import { effectiveTokens } from "./index";
import { TOKENS } from "./tokens";

/** RGBA pixels: `n` of one color plus `m` of another. */
function pixels(parts: [number, number, number, number][]) {
  const out: number[] = [];
  for (const [r, g, b, n] of parts) for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return new Uint8ClampedArray(out);
}

describe("colors from album art", () => {
  it("picks the cover's colorful color over a bigger grey area", () => {
    const c = sourceColor(pixels([[128, 128, 128, 3000], [220, 30, 40, 1096]]))!;
    const h = Hct.fromInt(c);
    expect(h.chroma).toBeGreaterThan(30);
    expect(h.hue < 40 || h.hue > 340).toBe(true); // red
  });

  it("grey covers give a source anyway, and a neutral scheme", () => {
    const c = sourceColor(pixels([[90, 90, 90, 4096]]));
    expect(c).not.toBeNull();
    const t = schemeTokens(c!, true);
    expect(Hct.fromInt(parseInt(t.accent.slice(1), 16) | 0xff000000).chroma).toBeLessThan(20);
  });

  it("no opaque pixels: no source (the palette stays)", () => {
    expect(sourceColor(new Uint8ClampedArray([1, 2, 3, 0]))).toBeNull();
  });

  it("maps a scheme onto every token, readable in dark and light", () => {
    const src = sourceColor(pixels([[30, 90, 200, 4096]]))!;
    for (const dark of [true, false]) {
      const t = schemeTokens(src, dark);
      for (const k of TOKENS) expect(isHex(t[k]), k).toBe(true);
      expect(isLight(t.bg)).toBe(!dark);
      expect(contrast(t.text, t.bg)).toBeGreaterThan(7);
      expect(contrast(t["on-accent"], t.accent)).toBeGreaterThan(4.5);
      expect(contrast(t["text-muted"], t.bg)).toBeGreaterThan(4.5);
    }
  });

  it("the user's overrides still win over the generated scheme", () => {
    const scheme = schemeTokens(sourceColor(pixels([[30, 160, 60, 4096]]))!, true);
    const t = effectiveTokens({ palette: "nord", mode: "dark", overrides: { accent: "#ff00ff" } }, scheme);
    expect(t.accent).toBe("#ff00ff");
    expect(t.bg).toBe(scheme.bg);
  });

  it("the track-change transition ends exactly on the new scheme", () => {
    const a = schemeTokens(0xffd32f2f, true), b = schemeTokens(0xff1e88e5, true);
    expect(mixTokens(a, b, 1)).toEqual(b);
    expect(mixTokens(a, b, 0).bg).toBe(a.bg);
  });

  it("migrates Accent from artwork and the old switch to Colors from album art", () => {
    expect(normalizeAppearance({ coverAccent: true }).coverColors).toBe("app");
    expect(normalizeAppearance({ coverAccent: false }).coverColors).toBe("off");
    expect(normalizeAppearance({ coverColors: true, coverAccent: false }).coverColors).toBe("app");
    expect(normalizeAppearance({ coverColors: false }).coverColors).toBe("off");
    expect(normalizeAppearance({ coverColors: "nowPlaying" }).coverColors).toBe("nowPlaying");
    expect(normalizeAppearance({ coverColors: "sometimes" }).coverColors).toBe("off");
    expect(normalizeAppearance({}).coverColors).toBe("off");
    expect("coverAccent" in normalizeAppearance({ coverAccent: true })).toBe(false);
  });
});
