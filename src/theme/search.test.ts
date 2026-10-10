import { describe, expect, it } from "vitest";
import { exportTheme, importTheme } from "../components/appearance/ThemeTransfer";
import { DEFAULT_APPEARANCE } from "./appearance";
import { PALETTES } from "./palettes";
import { fold, searchPalettes } from "./search";

describe("palette search", () => {
  it("ignores case and diacritics", () => {
    expect(fold("Rosé PINE")).toBe("rose pine");
    expect(searchPalettes(PALETTES, "ROSÉ").some((p) => p.id === "rose-pine")).toBe(true);
  });

  it("matches every word in any order, empty query = all", () => {
    expect(searchPalettes(PALETTES, "mocha catppuccin").every((p) => p.id.includes("mocha"))).toBe(true);
    expect(searchPalettes(PALETTES, "  ")).toHaveLength(PALETTES.length);
    expect(searchPalettes(PALETTES, "zzzz-nothing")).toHaveLength(0);
  });
});

describe("theme import/export", () => {
  it("round-trips the appearance", () => {
    const a = { ...DEFAULT_APPEARANCE, palette: "nord", mode: "light" as const, overrides: { accent: "#123456" }, zoom: 1.1 };
    expect(importTheme(exportTheme(a))).toEqual(a);
  });

  it("rejects other JSON", () => {
    expect(() => importTheme("{")).toThrow(/JSON/);
    expect(() => importTheme('{"palette":"nord"}')).toThrow(/ytdesk theme/);
  });
});
