import { describe, expect, it } from "vitest";
import { Spring, setMotionEnabled, tween } from "./engine";
import { settled, springAt, SPRINGS } from "./spring";

/** Samples a spring every 1/120 s until it settles; returns the path and the settle time. */
function run(p: { damping: number; stiffness: number }, from: number, to: number, v0 = 0) {
  const xs: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const { x, v } = springAt(p, from, to, v0, i / 120);
    xs.push(x);
    if (settled(x, v, to)) return { xs, t: i / 120 };
  }
  return { xs, t: Infinity };
}

describe("spring solver", () => {
  it("starts at `from` with the given velocity", () => {
    for (const p of Object.values(SPRINGS)) {
      const s = springAt(p, 10, 50, 3, 0);
      expect(s.x).toBeCloseTo(10, 9);
      expect(s.v).toBeCloseTo(3, 9);
    }
  });

  it("every preset settles at the target in well under 2 s", () => {
    for (const p of Object.values(SPRINGS)) {
      const r = run(p, 0, 100);
      expect(r.t).toBeLessThan(2);
      expect(r.xs.at(-1)!).toBeCloseTo(100, 1);
    }
  });

  it("spatial springs overshoot, effects springs never do", () => {
    expect(Math.max(...run(SPRINGS.fastSpatial, 0, 100).xs)).toBeGreaterThan(100);
    for (const p of [SPRINGS.fastEffects, SPRINGS.defaultEffects, SPRINGS.slowEffects])
      expect(Math.max(...run(p, 0, 100).xs)).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("faster presets settle sooner", () => {
    expect(run(SPRINGS.fastSpatial, 0, 100).t).toBeLessThan(run(SPRINGS.defaultSpatial, 0, 100).t);
    expect(run(SPRINGS.defaultSpatial, 0, 100).t).toBeLessThan(run(SPRINGS.slowSpatial, 0, 100).t);
  });

  it("velocity matches the derivative of position (all damping regimes)", () => {
    for (const p of [{ damping: 0.5, stiffness: 400 }, { damping: 1, stiffness: 400 }, { damping: 1.6, stiffness: 400 }]) {
      const t = 0.05, h = 1e-6;
      const a = springAt(p, 0, 10, 2, t), b = springAt(p, 0, 10, 2, t + h);
      expect((b.x - a.x) / h).toBeCloseTo(a.v, 3);
    }
  });
});

describe("animation switch", () => {
  it("without a frame clock (or with animations off) a spring jumps to its target and calls onDone", () => {
    const seen: number[] = [];
    let done = 0;
    const s = new Spring(0, "defaultSpatial", (v) => seen.push(v));
    s.to(40, () => done++);
    expect(s.value).toBe(40);
    expect(seen).toEqual([40]);
    expect(done).toBe(1);
    setMotionEnabled(false);
    s.to(5);
    expect(s.value).toBe(5);
    setMotionEnabled(true);
  });

  it("a tween finishes immediately when nothing can animate", () => {
    const seen: number[] = [];
    let done = false;
    tween(200, (t) => t, (p) => seen.push(p), () => (done = true));
    expect(seen).toEqual([1]);
    expect(done).toBe(true);
  });
});
