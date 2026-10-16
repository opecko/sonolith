import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { ticker } from "../motion";
import { useUiStyle } from "./UiStyle";

const N = 72;
const TAU = Math.PI * 2;

/** Rounded polygon of `n` sides as a polar radius, softened toward a circle by `soft` (0–1). */
const polygon = (n: number, soft: number) => (a: number) => {
  const seg = TAU / n;
  const r = Math.cos(Math.PI / n) / Math.cos(((((a % seg) + seg) % seg) - seg / 2));
  return r * (1 - soft) + soft;
};
const lobes = (n: number, depth: number) => (a: number) => 1 - depth + depth * Math.cos(n * a);
const ellipse = (rx: number, ry: number, tilt = 0) => (a: number) => {
  const t = a - tilt;
  return (rx * ry) / Math.hypot(ry * Math.cos(t), rx * Math.sin(t));
};

/** The M3 loading indicator's shape sequence: soft burst, 9-cookie, pentagon, pill, sunny, 4-cookie, oval. */
const SHAPES = [lobes(10, 0.1), lobes(9, 0.07), polygon(5, 0.35), ellipse(1, 0.58, Math.PI / 4), lobes(8, 0.12), lobes(4, 0.12), ellipse(1, 0.78, -Math.PI / 4)]
  .map((f) => {
    const pts = Array.from({ length: N }, (_, i) => f((i / N) * TAU));
    const max = Math.max(...pts);
    return pts.map((r) => r / max);
  });

const path = (radii: number[], size: number, rot: number) => {
  const c = size / 2;
  return radii.map((r, i) => {
    const a = (i / N) * TAU + rot;
    return `${i ? "L" : "M"}${(c + Math.cos(a) * r * c).toFixed(2)} ${(c + Math.sin(a) * r * c).toFixed(2)}`;
  }).join("") + "Z";
};

/** Seconds per shape: a quick morph, then a short hold. */
const STEP = 0.65;
const MORPH = 0.45;
/** Overshooting ease (M3 expressive spatial curve, approximated). */
const ease = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

/**
 * M3 Expressive loading indicator: a shape that morphs through the sequence while turning. Drawn as an SVG path
 * from the shared frame loop, only while mounted and visible; with animations off it rests on the first shape.
 */
export function LoadingIndicator({ size = 48, contained = false, label = "Loading" }: { size?: number; contained?: boolean; label?: string }) {
  const ref = useRef<SVGPathElement>(null);
  const inner = Math.round(size * (contained ? 0.62 : 0.8));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute("d", path(SHAPES[0], inner, 0));
    let t = 0, rot = 0, acc = 0;
    return ticker((dt) => {
      t += dt;
      rot += dt * 2.6;
      acc += dt;
      // ~40 fps: smooth enough for a small shape, fewer repaints.
      if (acc < 1 / 40) return;
      acc = 0;
      const i = Math.floor(t / STEP) % SHAPES.length;
      const a = SHAPES[i], b = SHAPES[(i + 1) % SHAPES.length];
      const p = ease(Math.min(1, (t % STEP) / MORPH));
      el.setAttribute("d", path(a.map((r, k) => r + (b[k] - r) * p), inner, rot));
    });
  }, [inner]);
  return (
    <span role="progressbar" aria-label={label} className={`m3-loading inline-flex shrink-0 items-center justify-center rounded-full ${contained ? "m3-loading-contained" : ""}`}
      style={{ width: size, height: size }}>
      <svg width={inner} height={inner} viewBox={`0 0 ${inner} ${inner}`} aria-hidden><path ref={ref} fill="currentColor" /></svg>
    </span>
  );
}

/** Small busy indicator in either style: Classic's spinner or the M3 loading indicator. */
export function Spinner({ size = 24, label = "Loading", className = "" }: { size?: number; label?: string; className?: string }) {
  return useUiStyle() === "m3"
    ? <LoadingIndicator size={Math.round(size * 1.5)} label={label} />
    : <Loader2 size={size} className={`animate-spin ${className}`} aria-label={label} />;
}
