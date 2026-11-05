import { describe, expect, it } from "vitest";
import { pickTransition, transitionFrame, TRANSITIONS } from "./transitions";

describe("card transitions", () => {
  it("every kind ends with the incoming card untouched", () => {
    for (const k of TRANSITIONS) for (const dir of [1, -1] as const) expect(transitionFrame(k, 1, dir).in).toEqual({ transform: "none", clipPath: "none", opacity: "1" });
  });
  it("frames move the right way and stay finite", () => {
    expect(transitionFrame("push", 0, 1).in.transform).toBe("translateX(100%)");
    expect(transitionFrame("push", 0, -1).in.transform).toBe("translateX(-100%)");
    for (const k of TRANSITIONS) for (const p of [0, 0.3, 0.7]) expect(JSON.stringify(transitionFrame(k, p, 1))).not.toMatch(/NaN|Infinity/);
  });
  it("big reveals use the circle; the rest vary but are stable per seed", () => {
    expect(pickTransition(1, 5, "topArtist")).toBe("circle");
    expect(pickTransition(9, 3, "hours")).toBe(pickTransition(9, 3, "hours"));
    const kinds = new Set(Array.from({ length: 40 }, (_, i) => pickTransition(7, i, "calendar")));
    expect(kinds.size).toBeGreaterThan(3);
    expect(kinds.has("circle")).toBe(false);
  });
});
