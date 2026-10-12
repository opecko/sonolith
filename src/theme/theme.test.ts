import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, normalizeAppearance } from "./appearance";
import { contrast, isHex, mix, over, parseHex, toHex, withAlpha } from "./color";
import { APP_FONT, effectiveTokens, fontStack } from "./index";
import { DEFAULT_TOKENS, TOKENS } from "./tokens";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/** index.css value → #rrggbb[aa], or null for var() references. */
function cssToHex(v: string): string | null {
  if (v.startsWith("var(")) return null;
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
  if (m) return toHex({ r: +m[1], g: +m[2], b: +m[3], a: +m[4] });
  return toHex(parseHex(v)!);
}

describe("tokens", () => {
  it("defaults match the :root values in index.css", () => {
    for (const t of TOKENS) {
      const m = new RegExp(`--c-${t}:\\s*([^;]+);`).exec(css);
      expect(m, t).not.toBeNull();
      const hex = cssToHex(m![1].trim());
      if (hex) expect(hex, t).toBe(DEFAULT_TOKENS[t]);
    }
  });

  it("a custom main color carries over to the tokens that follow it", () => {
    const nord = effectiveTokens({ palette: "nord", mode: "dark", overrides: { accent: "#00ff00", "on-accent": "#111111" } });
    expect(nord["slider-fill"]).toBe("#00ff00");
    expect(nord.button).toBe("#00ff00");
    expect(nord["on-button"]).toBe("#111111");
    const own = effectiveTokens({ palette: "nord", mode: "dark", overrides: { accent: "#00ff00", "slider-fill": "#0000ff" } });
    expect(own["slider-fill"]).toBe("#0000ff");
    // The built-in look keeps its white buttons.
    expect(effectiveTokens({ palette: "ytm", mode: "dark", overrides: { accent: "#00ff00" } }).button).toBe(DEFAULT_TOKENS.button);
  });

  it("built-in look resolves var() chains through overrides", () => {
    const t = effectiveTokens({ palette: "ytm", mode: "dark", overrides: { accent: "#00ff00" } });
    expect(t["slider-fill"]).toBe("#00ff00");
    expect(t.bg).toBe(DEFAULT_TOKENS.bg);
  });
});

describe("color", () => {
  it("parses and prints hex", () => {
    expect(toHex(parseHex("#FFF")!)).toBe("#ffffff");
    expect(parseHex("#ff000080")!.a).toBeCloseTo(0.5, 2);
    expect(isHex("#12345")).toBe(false);
    expect(isHex("red")).toBe(false);
  });

  it("mixes, fades and composites", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(withAlpha("#ffffff", 0.1)).toBe("#ffffff1a");
    expect(over("#ffffff80", "#000000")).toBe("#808080");
  });

  it("computes WCAG contrast", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});

describe("normalizeAppearance", () => {
  it("fills defaults for settings saved before 1.2", () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  });

  it("drops malformed values and clamps ranges", () => {
    const a = normalizeAppearance({ mode: "sepia", overrides: { bg: "#ABC", text: "red", nope: "#fff" }, zoom: 9, radius: "x" });
    expect(a.mode).toBe("dark");
    expect(a.overrides).toEqual({ bg: "#abc" });
    expect(a.zoom).toBe(1.25);
    expect(a.radius).toBe(DEFAULT_APPEARANCE.radius);
  });
});

describe("font", () => {
  it("app font matches index.css and keeps its own stack", () => {
    expect(css).toContain(`--font: ${APP_FONT};`);
    expect(fontStack("app", "")).toBeNull();
  });

  it("builds stacks for system, monospace and installed fonts", () => {
    expect(fontStack("system", "")).toBe("system-ui, sans-serif");
    expect(fontStack("mono", "")).toBe("ui-monospace, monospace");
    expect(fontStack("custom", ' My "Font" ')).toBe(`"My \\"Font\\"", ${APP_FONT}`);
    expect(fontStack("custom", "  ")).toBeNull();
  });

  it("migrates and validates the setting", () => {
    expect(normalizeAppearance({}).font).toBe("app");
    expect(normalizeAppearance({ font: "comic", fontFamily: 3 })).toMatchObject({ font: "app", fontFamily: "" });
    expect(normalizeAppearance({ font: "custom", fontFamily: "Fira Sans" })).toMatchObject({ font: "custom", fontFamily: "Fira Sans" });
  });
});
