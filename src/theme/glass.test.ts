import { describe, expect, it } from "vitest";
import { clampOpacity, DEFAULT_OPACITY, FLOAT_MIN, floatOpacity, GLASS_PROPS, glassVars } from "./glass";
import { DEFAULT_TOKENS } from "./tokens";

describe("surface opacity", () => {
  it("clamps to 30–100 % and falls back to the default", () => {
    expect(clampOpacity(0.1)).toBe(0.3);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(0.456)).toBe(0.46);
    expect(clampOpacity("0.5")).toBe(DEFAULT_OPACITY);
    expect(clampOpacity(Number.NaN)).toBe(DEFAULT_OPACITY);
  });

  it("menus, dialogs and tooltips never go below their minimum", () => {
    expect(floatOpacity(0.3)).toBe(FLOAT_MIN);
    expect(floatOpacity(0.97)).toBe(0.97);
  });

  it("fades only the surface tokens, the floats less", () => {
    const v = glassVars({ ...DEFAULT_TOKENS, bg: "#000000", "surface-3": "#ffffff80" }, 0.5);
    expect(v["--c-bg"]).toBe("#00000080");
    expect(v["--c-bg-float"]).toBe("#000000eb"); // 0.92
    expect(v["--c-surface-3"]).toBe("#ffffff40"); // already 50 %: halved again
    expect(Object.keys(v).sort()).toEqual([...GLASS_PROPS].sort());
    expect(Object.keys(v).some((k) => /text|accent/.test(k))).toBe(false);
  });
});
