import { useEffect, useRef } from "react";
import { ticker } from "../motion";
import { getAudio, usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";
import { acquire, analyserFor, FFT_SIZE } from "./tap";
import { bandLevels, energy, makeBands, pace, parseRgb, sampleLevels, smoothLevels, withAlpha, type Band } from "./spectrum";
import type { VisualizerMode, VisualizerStyle } from "./settings";

/**
 * Where a visualizer sits: along the bottom of Now Playing, over the bottom of the cover, a glow around the cover,
 * or (where the cover's box clips anything outside it, Bento) a glow inside its edges.
 */
export type VisualizerPlace = "background" | "cover" | "halo" | "halo-inner";

const MODE: Record<VisualizerPlace, VisualizerMode> = { background: "background", cover: "cover", halo: "halo", "halo-inner": "halo" };
const BANDS: Record<VisualizerPlace, number> = { background: 56, cover: 32, halo: 12, "halo-inner": 12 };
/**
 * Canvas pixels per CSS pixel, and the most it gets. One canvas pixel per CSS pixel (not per device pixel) keeps
 * the edges clean while each frame stays a small draw and upload; on software-rendered WebKitGTK the area and the
 * frame rate are what cost (pitfalls.md: a 20 fps canvas wave once took ~30 % CPU). The glow is soft anyway, so
 * it's drawn at half size.
 */
const SCALE: Record<VisualizerPlace, [number, number, number]> = {
  background: [1, 1920, 240],
  cover: [1, 720, 220],
  halo: [0.5, 420, 420],
  "halo-inner": [0.5, 420, 420],
};
const FPS_FOCUSED = 30;
const FPS_UNFOCUSED = 24;
/** The glow's canvas reaches this far past the cover on each side, as a share of its own size (CLASSES.halo). */
const HALO_MARGIN = 0.15 / 1.3;

// A canvas keeps its intrinsic size unless both width and height are given (pitfalls.md).
const CLASSES: Record<VisualizerPlace, string> = {
  background: "bottom-0 left-0 h-[24%] w-full text-[var(--m3-primary)]",
  cover: "bottom-0 left-0 h-[30%] w-full text-[var(--c-on-scrim)]",
  halo: "-left-[15%] -top-[15%] h-[130%] w-[130%] text-[var(--m3-primary)]",
  "halo-inner": "left-0 top-0 h-full w-full text-[var(--m3-primary)]",
};

/**
 * The audio visualizer (Settings → Now Playing). Shows only in its mode, while Now Playing is open and animations
 * are on. It draws on the shared motion ticker, at most 30 times a second (24 while another window has focus, or
 * not at all if the user turned that off), never while the window is hidden, and stops once paused audio has died
 * down. Colors come from the theme: the canvas's CSS `color`, read about once a second (it follows cover colors).
 */
export default function Visualizer({ at }: { at: VisualizerPlace }) {
  const on = useSettings((s) => s.visualizer.mode === MODE[at] && s.appearance.animations);
  const style = useSettings((s) => s.visualizer.style);
  const unfocused = useSettings((s) => s.visualizer.unfocused);
  const open = useUi((s) => s.nowPlaying);
  if (!on || !open) return null;
  return <Canvas at={at} style={style} unfocused={unfocused} />;
}

/**
 * `sample`: a Settings preview, moving to made-up levels (spectrum.ts sampleLevels) instead of the audio; it needs
 * nothing playing, and with animations off holds one frame.
 */
function Canvas({ at, style, unfocused, sample = false }: { at: VisualizerPlace; style: VisualizerStyle; unfocused: boolean; sample?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const release = sample ? () => {} : acquire();
    let clock = 1.2;
    const halo = at === "halo" || at === "halo-inner";
    const levels = new Float32Array(BANDS[at]);
    const target = new Float32Array(BANDS[at]);
    let db = new Float32Array(FFT_SIZE / 2);
    let bands: Band[] = [];
    let rate = 0;
    let rgb: [number, number, number] = [255, 255, 255];
    let colorAge = Infinity;
    // Cached per size and color: the bars' gradient, the glow's pre-drawn sprite.
    let fill: CanvasGradient | null = null;
    let sprite: HTMLCanvasElement | null = null;
    let carry = 0;
    let sinceDraw = 0;
    let blank = true;

    const [scale, maxW, maxH] = SCALE[at];
    const resize = () => {
      const w = Math.max(8, Math.min(maxW, Math.round(canvas.clientWidth * scale)));
      const h = Math.max(8, Math.min(maxH, Math.round(canvas.clientHeight * scale)));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      fill = null;
      sprite = null;
      draw(); // a resize clears the canvas
    };

    const draw = () => {
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      if (halo) {
        sprite ??= glowSprite(w, h, rgb, cornerRadius(canvas) * (w / Math.max(1, canvas.clientWidth)), at === "halo-inner");
        return drawGlow(ctx, sprite, levels, at === "halo-inner");
      }
      if (!fill) {
        fill = ctx.createLinearGradient(0, 0, 0, h);
        const strong = at === "cover" ? 0.9 : 0.6;
        fill.addColorStop(0, withAlpha(rgb, strong * 0.2));
        fill.addColorStop(1, withAlpha(rgb, strong));
      }
      ctx.fillStyle = fill;
      if (style === "wave") drawWave(ctx, w, h, levels);
      else drawBars(ctx, w, h, levels);
    };

    const frame = (dt: number) => {
      const focused = document.hasFocus();
      if (!focused && !unfocused) return halt();
      const [due, c] = pace(carry, dt, focused ? FPS_FOCUSED : FPS_UNFOCUSED);
      carry = c;
      sinceDraw += dt;
      if (!due) return;
      const step = sinceDraw;
      sinceDraw = 0;
      const analyser = sample ? null : analyserFor();
      if (sample) sampleLevels((clock += step), target);
      else if (analyser) {
        if (analyser.context.sampleRate !== rate) {
          rate = analyser.context.sampleRate;
          bands = makeBands(levels.length, rate, analyser.fftSize);
          db = new Float32Array(analyser.frequencyBinCount);
        }
        analyser.getFloatFrequencyData(db);
        bandLevels(db, bands, target);
      } else target.fill(0);
      const max = smoothLevels(levels, target, step);
      if ((colorAge += step) > 1) {
        colorAge = 0;
        const next = parseRgb(getComputedStyle(canvas).color);
        if (next && next.join() !== rgb.join()) {
          rgb = next;
          fill = null;
          sprite = null;
        }
      }
      if (max === 0) {
        if (!blank) ctx.clearRect(0, 0, canvas.width, canvas.height);
        blank = true;
        // Paused and settled: nothing to draw until playback resumes.
        if (!sample && getAudio().paused) halt();
        return;
      }
      blank = false;
      draw();
    };

    let stop: (() => void) | null = null;
    const run = () => {
      if (!stop) stop = ticker(frame);
    };
    const halt = () => {
      stop?.();
      stop = null;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    if (sample) {
      // A frame right away (and the only one with animations off, when the ticker doesn't run).
      sampleLevels(clock, levels);
      rgb = parseRgb(getComputedStyle(canvas).color) ?? rgb;
      colorAge = 0;
      draw();
    }
    run();
    const unsub = usePlayer.subscribe((s, prev) => s.status !== prev.status && s.status === "playing" && run());
    window.addEventListener("focus", run);
    return () => {
      halt();
      ro.disconnect();
      unsub();
      window.removeEventListener("focus", run);
      release();
    };
  }, [at, style, unfocused, sample]);
  const canvas = <canvas ref={ref} aria-hidden className={`pointer-events-none absolute ${CLASSES[at]}`} />;
  if (at !== "cover") return canvas;
  // Bars in the on-scrim color stay readable over a light cover.
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-t from-scrim/50 to-transparent" />
      {canvas}
    </>
  );
}

/**
 * A small mock-up of Now Playing (a cover in the middle) showing `mode` on made-up music, for Settings: the same
 * drawing as the real thing, nothing has to play.
 */
export function VisualizerPreview({ mode, style }: { mode: VisualizerMode; style: VisualizerStyle }) {
  const art = "rounded-[var(--m3-corner-sm)] bg-[linear-gradient(135deg,var(--m3-tertiary-container),var(--m3-primary-container))]";
  return (
    <div className="relative h-24 w-full overflow-hidden rounded-[var(--m3-corner-sm)] bg-[var(--m3-surface-container-highest)]" aria-hidden>
      {mode === "background" && <Canvas at="background" style={style} unfocused={false} sample />}
      <div className={`absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 ${mode === "halo" ? art : ""}`}>
        {mode === "halo" && <Canvas at="halo" style={style} unfocused={false} sample />}
        <div className={`absolute inset-0 overflow-hidden ${art}`}>
          {mode === "cover" && <Canvas at="cover" style={style} unfocused={false} sample />}
        </div>
      </div>
    </div>
  );
}

/** The cover's corner radius in CSS px (the glow follows its shape). */
function cornerRadius(canvas: HTMLCanvasElement) {
  const box = canvas.parentElement;
  return box ? parseFloat(getComputedStyle(box).borderTopLeftRadius) || 0 : 0;
}

function drawBars(ctx: CanvasRenderingContext2D, w: number, h: number, levels: Float32Array) {
  const n = levels.length;
  const slot = w / n;
  const bar = Math.max(1, Math.round(slot * 0.62));
  const r = bar / 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const v = levels[i];
    if (v <= 0) continue;
    const bh = Math.max(2, Math.round(v * h));
    const x = Math.round(i * slot + (slot - bar) / 2);
    // Rounded tops; the rounded bottom runs off the canvas.
    if (ctx.roundRect) ctx.roundRect(x, h - bh, bar, bh + r, Math.min(r, bh / 2));
    else ctx.rect(x, h - bh, bar, bh);
  }
  ctx.fill();
}

/** A filled curve through the band levels (midpoint quadratic smoothing). */
function drawWave(ctx: CanvasRenderingContext2D, w: number, h: number, levels: Float32Array) {
  const n = levels.length;
  const slot = w / n;
  const y = (i: number) => h - levels[i] * h * 0.95;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, y(0));
  for (let i = 0; i < n - 1; i++) {
    const x = (i + 0.5) * slot;
    ctx.quadraticCurveTo(x, y(i), x + slot / 2, (y(i) + y(i + 1)) / 2);
  }
  ctx.lineTo(w, y(n - 1));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

/**
 * The glow, drawn once per size and color: the cover's rounded square cast as a blurred shadow around it, or from
 * its edges inward. The shape itself is drawn off the canvas and only its shadow is offset into view, so no hard
 * edge ever shows. Each frame then just stamps this sprite with an alpha, far cheaper than blurring live.
 */
function glowSprite(w: number, h: number, rgb: [number, number, number], radius: number, inner: boolean) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) return c;
  const off = w * 3;
  g.shadowColor = withAlpha(rgb, 1);
  g.shadowOffsetX = off;
  g.beginPath();
  if (inner) {
    // A frame around the canvas whose shadow falls inside it.
    g.shadowBlur = Math.min(w, h) * 0.12;
    g.rect(-off - w, -h, w * 3, h * 3);
    if (g.roundRect) g.roundRect(-off, 0, w, h, radius);
    else g.rect(-off, 0, w, h);
    g.fill("evenodd");
  } else {
    const mx = w * HALO_MARGIN;
    const my = h * HALO_MARGIN;
    const r = Math.max(0, Math.min(radius, (w - 2 * mx) / 2));
    g.shadowBlur = Math.min(w, h) * 0.08;
    if (g.roundRect) g.roundRect(mx - off, my, w - 2 * mx, h - 2 * my, r);
    else g.rect(mx - off, my, w - 2 * mx, h - 2 * my);
    // Twice: one blurred shadow alone is too faint at its edge.
    g.fill();
    g.fill();
  }
  return c;
}

/**
 * Stamps the glow sprite, brighter with the bass. Only its alpha moves: the sprite's solid middle sits exactly
 * under the cover, and scaling it would show that as a hard band around it.
 */
function drawGlow(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, levels: Float32Array, inner: boolean) {
  const strength = Math.min(1, energy(levels, 0, 3) * 0.8 + energy(levels) * 0.5);
  if (strength <= 0.01) return;
  ctx.globalAlpha = inner ? strength * 0.7 : strength;
  ctx.drawImage(sprite, 0, 0);
  ctx.globalAlpha = 1;
}
