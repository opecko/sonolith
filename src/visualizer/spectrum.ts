/**
 * The visualizer's audio math, pure so it can be tested: FFT bins (dB, from an AnalyserNode) → a few log-spaced
 * bands normalized to 0–1, smoothed over time, plus the frame pacing that keeps its CPU cost down.
 */

/** One band: a fractional FFT bin range and a loudness tilt in dB (music has less energy up high). */
export interface Band {
  lo: number;
  hi: number;
  tilt: number;
}

/** dB per octave added above 1 kHz (and taken away below), so the treble bars move as much as the bass ones. */
const TILT_PER_OCTAVE = 3;

/** `count` bands spaced evenly on a log scale between `minHz` and `maxHz`. */
export function makeBands(count: number, sampleRate: number, fftSize: number, minHz = 50, maxHz = 16000): Band[] {
  const binHz = sampleRate / fftSize;
  const lastBin = fftSize / 2 - 1;
  const top = Math.min(maxHz, (lastBin - 1) * binHz);
  const ratio = top / minHz;
  const bands: Band[] = [];
  for (let i = 0; i < count; i++) {
    const f0 = minHz * ratio ** (i / count);
    const f1 = minHz * ratio ** ((i + 1) / count);
    bands.push({ lo: f0 / binHz, hi: f1 / binHz, tilt: TILT_PER_OCTAVE * Math.log2(Math.sqrt(f0 * f1) / 1000) });
  }
  return bands;
}

/**
 * Bins → band levels in `out` (0–1). A band narrower than one bin (the bass, at a usable FFT size) interpolates
 * between the two nearest bins, so neighbouring bars don't move as one block; a wider band takes its loudest bin.
 */
export function bandLevels(db: ArrayLike<number>, bands: readonly Band[], out: Float32Array, minDb = -82, maxDb = -22) {
  const range = maxDb - minDb;
  for (let k = 0; k < bands.length; k++) {
    const { lo, hi, tilt } = bands[k];
    let v: number;
    if (hi - lo < 1) {
      const x = (lo + hi) / 2;
      const i = Math.min(Math.floor(x), db.length - 2);
      const f = x - i;
      v = db[i] * (1 - f) + db[i + 1] * f;
    } else {
      v = -Infinity;
      const end = Math.min(Math.ceil(hi), db.length);
      for (let i = Math.floor(lo); i < end; i++) if (db[i] > v) v = db[i];
    }
    const n = (v + tilt - minDb) / range;
    // Silence comes as -Infinity (and NaN from -Infinity * 0 above).
    out[k] = n > 0 ? (n < 1 ? n : 1) : 0;
  }
}

/**
 * Moves `cur` toward `target` with a fast rise and a slower fall (a VU-meter feel), frame-rate independent.
 * Returns the largest level, so the caller knows when everything has died down.
 */
export function smoothLevels(cur: Float32Array, target: ArrayLike<number>, dt: number, rise = 28, fall = 7) {
  const up = 1 - Math.exp(-dt * rise);
  const down = 1 - Math.exp(-dt * fall);
  let max = 0;
  for (let i = 0; i < cur.length; i++) {
    const t = target[i] ?? 0;
    const c = cur[i] + (t - cur[i]) * (t > cur[i] ? up : down);
    cur[i] = c < 0.002 ? 0 : c;
    if (cur[i] > max) max = cur[i];
  }
  return max;
}

/** Mean level of bands [from, to). */
export function energy(levels: ArrayLike<number>, from = 0, to = levels.length) {
  const end = Math.min(to, levels.length);
  if (end <= from) return 0;
  let sum = 0;
  for (let i = from; i < end; i++) sum += levels[i];
  return sum / (end - from);
}

/**
 * Frame pacing: the motion ticker calls every display frame, the visualizer draws at most `fps` times a second.
 * Returns whether to draw now and the time carried over (capped, so a stall doesn't cause a burst).
 */
export function pace(carry: number, dt: number, fps: number): [draw: boolean, carry: number] {
  const interval = 1 / fps;
  const t = carry + dt;
  // A little slack, so 30 fps on a 60 Hz display draws every second frame instead of drifting to every third.
  if (t < interval * 0.9) return [false, t];
  return [true, Math.min(t - interval, interval)];
}

/** "rgb(1, 2, 3)" / "rgba(1, 2, 3, 0.5)" / "rgb(1 2 3)" (a computed CSS color) → [r, g, b]; null if it isn't one. */
export function parseRgb(css: string): [number, number, number] | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(css.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** A theme color (as computed) with an alpha, for canvas fills. */
export const withAlpha = ([r, g, b]: readonly [number, number, number], a: number) => `rgb(${r} ${g} ${b} / ${a})`;

/**
 * Made-up band levels at time `t` (seconds) for the Settings previews, so they move like music with nothing playing:
 * a kick on every beat (120 bpm) in the bass, slowly wandering mids, a hi-hat between the beats up high. Pure and
 * deterministic; writes into `out` (0–1).
 */
export function sampleLevels(t: number, out: Float32Array) {
  const n = out.length;
  const kick = Math.exp(-((t * 2) % 1) * 6);
  const hat = Math.exp(-((t * 2 + 0.5) % 1) * 12);
  for (let k = 0; k < n; k++) {
    const x = n > 1 ? k / (n - 1) : 0;
    const bass = kick * (1 - x) ** 2 * 0.75;
    const mids = (0.3 + 0.2 * Math.sin(t * 1.7 + x * 9) * Math.sin(t * 0.9 + x * 3)) * (1 - x * 0.5);
    const highs = hat * x ** 2 * 0.45;
    const v = 0.08 + bass + mids + highs;
    out[k] = v > 1 ? 1 : v < 0 ? 0 : v;
  }
}
