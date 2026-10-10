import { describe, expect, it } from "vitest";
import { contrast, isHex } from "./color";
import { PALETTES } from "./palettes";
import { paletteTokens, TOKENS } from "./tokens";
import { PALETTE_KEYS } from "./types";

describe("bundled palettes", () => {
  const bundled = PALETTES.filter((p) => p.source !== "builtin");

  it("are all there with unique ids", () => {
    expect(bundled.length).toBeGreaterThan(100);
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
  });

  it("have all 16 valid colors in every variant", () => {
    for (const p of bundled) {
      expect(p.dark || p.light, p.id).toBeTruthy();
      for (const v of [p.dark, p.light]) {
        if (!v) continue;
        for (const k of PALETTE_KEYS) expect(isHex(v[k]), `${p.id}.${k}`).toBe(true);
      }
    }
  });

  it("map to a complete, valid token set", () => {
    for (const p of bundled) {
      const t = paletteTokens((p.dark ?? p.light)!);
      for (const k of TOKENS) expect(isHex(t[k]), `${p.id} ${k}=${t[k]}`).toBe(true);
    }
  });

  it("maps the direct roles and keeps text readable", () => {
    const nord = PALETTES.find((p) => p.id === "nord")!.dark!;
    const t = paletteTokens(nord);
    expect(t.bg).toBe(nord.surface);
    expect(t.accent).toBe(nord.primary);
    expect(t["on-accent"]).toBe(nord.onPrimary);
    expect(t["surface-2"]).toBe(nord.surfaceVariant);
    expect(contrast(t.text, t.bg)).toBeGreaterThan(4.5);
  });
});
