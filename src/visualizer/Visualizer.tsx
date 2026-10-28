import { useEffect, useRef } from "react";
import { ticker } from "../motion";
import { getAudio, usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";
import { FFT_SIZE, getAnalyser } from "./tap";
import { bandLevels, energy, makeBands, pace, parseRgb, smoothLevels, volumeGainDb, withAlpha, type Band } from "./spectrum";
import type { VisualizerMode, VisualizerStyle } from "./settings";

/**
 * Where a visualizer sits: along the bottom of Now Playing, over the bottom of the cover, a glow around the cover,
 * or (where the cover's box clips anything outside it, Bento) a glow inside its edges.
 */
export type VisualizerPlace = "background" | "cover" | "halo" | "halo-inner";

const MODE: Record<VisualizerPlace, VisualizerMode> = { background: "background", cover: "cover", halo: "halo", "halo-inner": "halo" };
const BANDS: Record<VisualizerPlace, number> = { background: 48, cover: 28, halo: 12, "halo-inner": 12 };
/**
 * Canvas pixels per CSS pixel, and the most it gets. The browser stretches the canvas (like the ambient light), so
 * each frame is a small draw and a small upload; on software-rendered WebKitGTK the area and the frame rate are
 * what cost (pitfalls.md: a 20 fps canvas wave once took ~30 % CPU).
 */
const SCALE: Record<VisualizerPlace, [number, number, number]> = {
  background: [0.25, 400, 80],
  cover: [0.5, 320, 80],
  halo: [0, 64, 64],
  "halo-inner": [0, 64, 64],
};
const FPS_FOCUSED = 30;
const FPS_UNFOCUSED = 12;
/** The glow's canvas is this much bigger than the cover on each side, as a share of its own size (CLASSES.halo). */
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
 * are on. It draws on the shared motion ticker, at most 30 times a second (12 while another window has focus, or
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

function Canvas({ at, style, unfocused }: { at: VisualizerPlace; style: VisualizerStyle; unfocused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const audio = getAudio();
    const levels = new Float32Array(BANDS[at]);
    const target = new Float32Array(BANDS[at]);
    let db = new Float32Array(FFT_SIZE / 2);
    let bands: Band[] = [];
    let rate = 0;
    let rgb: [number, number, number] = [255, 255, 255];
    let colorAge = Infinity;
    let fill: CanvasGradient | string = "";
    let carry = 0;
    let sinceDraw = 0;
    let blank = true;

    const [scale, maxW, maxH] = SCALE[at];
    const resize = () => {
      const w = scale ? Math.max(8, Math.min(maxW, Math.round(canvas.clientWidth * scale))) : maxW;
      const h = scale ? Math.max(8, Math.min(maxH, Math.round(canvas.clientHeight * scale))) : maxH;
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      fill = "";
      draw(); // a resize clears the canvas
    };

    const draw = () => {
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      if (at === "halo" || at === "halo-inner") return drawHalo(ctx, w, levels, rgb, at === "halo-inner");
      if (!fill) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        const strong = at === "cover" ? 0.9 : 0.55;
        g.addColorStop(0, withAlpha(rgb, strong * 0.25));
        g.addColorStop(1, withAlpha(rgb, strong));
        fill = g;
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
      const analyser = audio.paused ? null : getAnalyser();
      if (analyser) {
        const ac = analyser.context;
        if (ac.sampleRate !== rate) {
          rate = ac.sampleRate;
          bands = makeBands(levels.length, rate, analyser.fftSize);
          db = new Float32Array(analyser.frequencyBinCount);
        }
        analyser.getFloatFrequencyData(db);
        bandLevels(db, bands, target, volumeGainDb(audio.volume));
      } else target.fill(0);
      const max = smoothLevels(levels, target, step);
      if ((colorAge += step) > 1) {
        colorAge = 0;
        const next = parseRgb(getComputedStyle(canvas).color);
        if (next && next.join() !== rgb.join()) {
          rgb = next;
          fill = "";
        }
      }
      if (max === 0) {
        if (!blank) ctx.clearRect(0, 0, canvas.width, canvas.height);
        blank = true;
        // Paused (or never tapped) and settled: nothing to draw until playback resumes.
        if (audio.paused) halt();
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
    run();
    const unsub = usePlayer.subscribe((s, prev) => s.status !== prev.status && s.status === "playing" && run());
    window.addEventListener("focus", run);
    return () => {
      halt();
      ro.disconnect();
      unsub();
      window.removeEventListener("focus", run);
    };
  }, [at, style, unfocused]);
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

function drawBars(ctx: CanvasRenderingContext2D, w: number, h: number, levels: Float32Array) {
  const slot = w / levels.length;
  const bar = Math.max(1, slot * 0.6);
  for (let i = 0; i < levels.length; i++) {
    const v = levels[i];
    if (v <= 0) continue;
    const bh = Math.max(1, v * h);
    ctx.fillRect(i * slot + (slot - bar) / 2, h - bh, bar, bh);
  }
}

/** A filled curve through the band levels (midpoint quadratic smoothing). */
function drawWave(ctx: CanvasRenderingContext2D, w: number, h: number, levels: Float32Array) {
  const n = levels.length;
  const slot = w / n;
  const y = (i: number) => h - levels[Math.max(0, Math.min(n - 1, i))] * h * 0.95;
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
 * A glow that breathes with the bass: the cover's square cast as a blurred shadow, around it (`inner` false; the
 * cover hides the middle) or inward from its edges. Drawn small and stretched, so the blur is cheap.
 */
function drawHalo(ctx: CanvasRenderingContext2D, size: number, levels: Float32Array, rgb: [number, number, number], inner: boolean) {
  const bass = energy(levels, 0, 3);
  const all = energy(levels);
  const strength = Math.min(1, bass * 0.75 + all * 0.5);
  if (strength <= 0.01) return;
  ctx.save();
  ctx.shadowColor = withAlpha(rgb, Math.min(1, strength * 1.1));
  ctx.fillStyle = withAlpha(rgb, inner ? 1 : Math.min(1, strength * 0.6));
  if (inner) {
    // A frame around the canvas whose shadow falls inside it.
    ctx.shadowBlur = size * (0.08 + 0.14 * strength);
    ctx.beginPath();
    ctx.rect(-size, -size, size * 3, size * 3);
    ctx.rect(0, 0, size, size);
    ctx.fill("evenodd");
  } else {
    const m = size * HALO_MARGIN;
    ctx.shadowBlur = size * (0.05 + 0.1 * strength);
    ctx.fillRect(m, m, size - 2 * m, size - 2 * m);
  }
  ctx.restore();
}
