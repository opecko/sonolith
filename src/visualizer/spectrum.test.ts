import { describe, expect, it } from "vitest";
import { bandLevels, energy, makeBands, pace, parseRgb, smoothLevels, volumeGainDb, withAlpha } from "./spectrum";
import { normalizeVisualizer } from "./settings";

describe("makeBands", () => {
  it("spaces bands on a log scale inside the spectrum", () => {
    const bands = makeBands(32, 48000, 2048);
    expect(bands).toHaveLength(32);
    for (let i = 1; i < bands.length; i++) expect(bands[i].lo).toBeCloseTo(bands[i - 1].hi);
    expect(bands[0].lo).toBeGreaterThan(0);
    expect(bands.at(-1)!.hi).toBeLessThan(1024);
    // Bass is tilted down, treble up.
    expect(bands[0].tilt).toBeLessThan(0);
    expect(bands.at(-1)!.tilt).toBeGreaterThan(0);
  });
});

describe("bandLevels", () => {
  const bands = makeBands(16, 48000, 2048);
  it("maps silence to zero and loud bins to one", () => {
    const out = new Float32Array(16);
    bandLevels(new Float32Array(1024).fill(-Infinity), bands, out);
    expect([...out].every((v) => v === 0)).toBe(true);
    bandLevels(new Float32Array(1024).fill(0), bands, out);
    expect([...out].every((v) => v === 1)).toBe(true);
  });

  it("interpolates bass bands narrower than a bin", () => {
    const db = new Float32Array(1024).fill(-100);
    db[3] = -30;
    const out = new Float32Array(16);
    bandLevels(db, bands, out);
    expect(Math.max(...out)).toBeGreaterThan(0);
    expect(out.at(-1)).toBe(0);
  });

  it("makes up for the volume", () => {
    const db = new Float32Array(1024).fill(-60);
    const quiet = new Float32Array(16);
    const loud = new Float32Array(16);
    bandLevels(db, bands, quiet);
    bandLevels(db, bands, loud, volumeGainDb(0.25));
    expect(loud[8]).toBeGreaterThan(quiet[8]);
  });
});

describe("volumeGainDb", () => {
  it("is zero at full volume and capped near silence", () => {
    expect(volumeGainDb(1)).toBeCloseTo(0);
    expect(volumeGainDb(0.5)).toBeCloseTo(6.02, 1);
    expect(volumeGainDb(0)).toBeCloseTo(volumeGainDb(0.0625));
  });
});

describe("smoothLevels", () => {
  it("rises faster than it falls and settles at zero", () => {
    const cur = new Float32Array([0, 1]);
    smoothLevels(cur, [1, 0], 1 / 30);
    expect(cur[0]).toBeGreaterThan(1 - cur[1]);
    let max = 1;
    for (let i = 0; i < 200 && max > 0; i++) max = smoothLevels(cur, [0, 0], 1 / 30);
    expect(max).toBe(0);
  });
});

describe("energy", () => {
  it("averages a range", () => {
    expect(energy([0, 1, 1, 0], 1, 3)).toBe(1);
    expect(energy([], 0)).toBe(0);
  });
});

describe("pace", () => {
  const count = (fps: number, hz: number) => {
    let carry = 0;
    let n = 0;
    for (let i = 0; i < hz; i++) {
      const [draw, c] = pace(carry, 1 / hz, fps);
      carry = c;
      if (draw) n++;
    }
    return n;
  };
  it("draws about fps times a second at any refresh rate", () => {
    expect(count(30, 60)).toBe(30);
    expect(count(15, 60)).toBe(15);
    expect(count(30, 144)).toBeGreaterThanOrEqual(28);
    expect(count(30, 144)).toBeLessThanOrEqual(32);
  });
  it("does not burst after a stall", () => {
    const [draw, carry] = pace(0, 2, 30);
    expect(draw).toBe(true);
    expect(carry).toBeLessThanOrEqual(1 / 30);
  });
});

describe("colors", () => {
  it("parses computed colors", () => {
    expect(parseRgb("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseRgb("rgba(10, 20, 30, 0.5)")).toEqual([10, 20, 30]);
    expect(parseRgb("rgb(1 2 3)")).toEqual([1, 2, 3]);
    expect(parseRgb("color(srgb 1 0 0)")).toBeNull();
    expect(withAlpha([1, 2, 3], 0.5)).toBe("rgb(1 2 3 / 0.5)");
  });
});

describe("normalizeVisualizer", () => {
  it("falls back to defaults", () => {
    expect(normalizeVisualizer(undefined)).toEqual({ mode: "off", style: "bars", unfocused: true });
    expect(normalizeVisualizer({ mode: "cover", style: "nope", unfocused: false })).toEqual({ mode: "cover", style: "bars", unfocused: false });
  });
});
