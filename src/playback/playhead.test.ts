import { describe, expect, it } from "vitest";
import { Interpolator } from "./playhead";

describe("smooth playhead", () => {
  it("runs on between coarse clock steps at the playback rate", () => {
    const p = new Interpolator();
    expect(p.sample(10, 0, 1, true)).toBe(10);
    expect(p.sample(10, 100, 1, true)).toBeCloseTo(10.1);
    expect(p.sample(10, 200, 2, true)).toBeCloseTo(10.4);
  });
  it("never runs more than half a second past the element", () => {
    const p = new Interpolator();
    p.sample(10, 0, 1, true);
    expect(p.sample(10, 3000, 1, true)).toBeCloseTo(10.5);
  });
  it("holds still instead of stepping back a little", () => {
    const p = new Interpolator();
    p.sample(10, 0, 1, true);
    expect(p.sample(10, 260, 1, true)).toBeCloseTo(10.26);
    // The element reports 10.25 a moment later.
    expect(p.sample(10.25, 270, 1, true)).toBeCloseTo(10.26);
    expect(p.sample(10.25, 300, 1, true)).toBeCloseTo(10.28);
  });
  it("snaps on a seek backwards, a pause and a reset", () => {
    const p = new Interpolator();
    p.sample(10, 0, 1, true);
    p.sample(10, 200, 1, true);
    expect(p.sample(3, 210, 1, true)).toBe(3);
    expect(p.sample(3.1, 300, 1, false)).toBe(3.1);
    p.reset();
    expect(p.sample(50, 400, 1, true)).toBe(50);
  });
});
