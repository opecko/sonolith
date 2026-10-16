import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, isHex } from "./color";
import { effectiveTokens, M3_CORNERS, m3Corner } from "./index";
import { m3Declarations, m3Roles, M3_ROLES, M3_CONTRAST_PAIRS } from "./m3";
import { hasMode, PALETTES } from "./palettes";

const css = readFileSync(new URL("./m3.css", import.meta.url), "utf8");
const luma = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);

describe("M3 color roles", () => {
  it("m3.css has exactly the recipes from m3.ts", () => {
    for (const d of m3Declarations()) expect(css, d).toContain(d);
    expect(css.match(/^\s*--m3-[a-z-]+: (?:var|color-mix)/gm)?.length).toBe(M3_ROLES.length);
  });

  it("every role resolves to a color for the built-in look and bundled palettes", () => {
    for (const palette of ["ytm", "nord", "catppuccin"]) for (const mode of ["dark", "light"] as const) {
      const roles = m3Roles(effectiveTokens({ palette, mode, overrides: {} }));
      for (const r of M3_ROLES) expect(isHex(roles[r]), `${palette}/${mode}/${r}`).toBe(true);
    }
  });

  it("surface containers step away from the background in both modes", () => {
    for (const mode of ["dark", "light"] as const) {
      const r = m3Roles(effectiveTokens({ palette: "nord", mode, overrides: {} }));
      const steps = ["surface", "surface-container-low", "surface-container", "surface-container-high", "surface-container-highest"] as const;
      const l = steps.map((s) => luma(r[s]));
      for (let i = 1; i < l.length; i++) mode === "dark" ? expect(l[i]).toBeGreaterThan(l[i - 1]) : expect(l[i]).toBeLessThan(l[i - 1]);
    }
  });

  it("follows the accent (custom color, artwork accent)", () => {
    const a = m3Roles(effectiveTokens({ palette: "nord", mode: "dark", overrides: { accent: "#00ff00" } }));
    expect(a.primary).toBe("#00ff00");
    expect(a["primary-container"]).not.toBe(m3Roles(effectiveTokens({ palette: "nord", mode: "dark", overrides: {} }))["primary-container"]);
  });

  it("text on containers stays readable for the built-in look", () => {
    for (const mode of ["dark", "light"] as const) {
      const r = m3Roles(effectiveTokens({ palette: "ytm", mode, overrides: {} }));
      expect(contrast(r["on-primary-container"], r["primary-container"])).toBeGreaterThan(4.5);
      expect(contrast(r["on-secondary-container"], r["secondary-container"])).toBeGreaterThan(4.5);
      expect(contrast(r["on-surface"], r["surface-container-high"])).toBeGreaterThan(4.5);
    }
  });

  it("text on containers keeps 4.5:1 for every bundled palette whose own text has 7:1", () => {
    const low: string[] = [];
    for (const p of PALETTES) for (const mode of ["dark", "light"] as const) {
      if (p.source !== "builtin" && !hasMode(p, mode)) continue;
      const t = effectiveTokens({ palette: p.id, mode, overrides: {} });
      if (contrast(t.text, t.bg) < 7) continue;
      const r = m3Roles(t);
      for (const { fg, bg } of M3_CONTRAST_PAIRS) if (contrast(r[fg], r[bg]) < 4.5) low.push(`${p.id}/${mode}: ${fg} on ${bg}`);
    }
    expect(low).toEqual([]);
  });

  it("tertiary is a real hue between the accents, not grey", () => {
    const r = m3Roles(effectiveTokens({ palette: "ytm", mode: "dark", overrides: { accent: "#ff8800", "accent-2": "#0088ff" } }));
    const [R, G, B] = [1, 3, 5].map((i) => parseInt(r.tertiary.slice(i, i + 2), 16));
    expect(Math.max(R, G, B) - Math.min(R, G, B)).toBeGreaterThan(60);
  });
});

describe("M3 corner scale", () => {
  it("is M3's own at 8px and scales with the corner setting", () => {
    expect(m3Corner("md", 8)).toBe(12);
    expect(m3Corner("xl", 16)).toBe(56);
    expect(m3Corner("full", 0)).toBe(0);
    for (const [k, v] of Object.entries(M3_CORNERS)) expect(css).toContain(`--m3-corner-${k}: ${v}px;`);
  });
});
