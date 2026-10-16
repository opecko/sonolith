/**
 * Damped spring (mass 1) solved analytically, so a frame can land at any time without integration error and a
 * retarget mid-flight keeps position and velocity exactly. Values are whatever unit the caller animates (px, %).
 */
export interface SpringParams {
  /** Damping ratio ζ: < 1 overshoots, 1 = critically damped (no overshoot). */
  damping: number;
  stiffness: number;
}

/** M3 Expressive spring tokens (docs/m3-expressive.md). Spatial = position/size/shape, effects = color/opacity. */
export const SPRINGS = {
  fastSpatial: { damping: 0.6, stiffness: 800 },
  defaultSpatial: { damping: 0.8, stiffness: 380 },
  slowSpatial: { damping: 0.8, stiffness: 200 },
  fastEffects: { damping: 1, stiffness: 3800 },
  defaultEffects: { damping: 1, stiffness: 1600 },
  slowEffects: { damping: 1, stiffness: 800 },
} as const satisfies Record<string, SpringParams>;

export type SpringPreset = keyof typeof SPRINGS;

/** Position and velocity `t` seconds after leaving `from` with velocity `v0`, heading for `to`. */
export function springAt(p: SpringParams, from: number, to: number, v0: number, t: number): { x: number; v: number } {
  const w0 = Math.sqrt(p.stiffness);
  const z = p.damping;
  const x0 = from - to;
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    const a = z * w0;
    const A = x0, B = (v0 + a * x0) / wd;
    const e = Math.exp(-a * t), c = Math.cos(wd * t), s = Math.sin(wd * t);
    return { x: to + e * (A * c + B * s), v: e * ((B * wd - a * A) * c - (a * B + A * wd) * s) };
  }
  if (z === 1) {
    const B = v0 + w0 * x0;
    const e = Math.exp(-w0 * t);
    return { x: to + (x0 + B * t) * e, v: e * (B - w0 * (x0 + B * t)) };
  }
  const d = w0 * Math.sqrt(z * z - 1);
  const r1 = -z * w0 + d, r2 = -z * w0 - d;
  const c2 = (v0 - r1 * x0) / (r2 - r1), c1 = x0 - c2;
  const e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t);
  return { x: to + c1 * e1 + c2 * e2, v: c1 * r1 * e1 + c2 * r2 * e2 };
}

/** Close enough to rest that the next frames wouldn't show a difference (`precision` in the value's unit). */
export const settled = (x: number, v: number, to: number, precision = 0.01) =>
  Math.abs(x - to) < precision && Math.abs(v) < precision * 10;
