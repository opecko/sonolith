import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useSpring } from "../motion";
import { useSettings } from "../stores/settings";
import { useUiStyle } from "./UiStyle";

interface SliderProps {
  value: number;
  max: number;
  onCommit: (v: number) => void;
  onChange?: (v: number) => void;
  live?: boolean;
  step: number;
  label: string;
  format?: (v: number) => string;
  /** "hover" labels the point under the pointer (seek preview); "value" labels the current value (still placed at the pointer). */
  tooltip?: "hover" | "value";
  disabled?: boolean;
  className?: string;
  /**
   * M3 look: "xs" = the expressive slider (16 px track, bar handle), "sm" = a smaller one for the player bar,
   * "seek" = a thin progress-style track. Classic ignores it.
   */
  size?: "xs" | "sm" | "seek";
  /** M3 "seek" only: the active track waves (playing); the wave flattens out when this turns false. */
  wavy?: boolean;
}

/** Pointer, keyboard and hover handling shared by both looks. */
function useSliderInput({ value, max, onCommit, onChange, live = false, step, disabled }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;

  // The position is a CSS variable (--p 0–100, --f 0–1) on the root, written before paint on every render.
  useLayoutEffect(() => {
    ref.current?.style.setProperty("--p", String(pct));
    ref.current?.style.setProperty("--f", String(pct / 100));
  });

  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * max;
  };
  const move = (v: number) => {
    setDrag(v);
    if (live) (onChange ?? onCommit)(v);
  };
  const key = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
    if (!d) return;
    e.preventDefault();
    onCommit(Math.min(max, Math.max(0, value + d)));
  };
  const handlers = {
    onKeyDown: key,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0) return;
      // No text selection from a press or double-click here, nor from a drag that leaves the slider; the default
      // focus goes with it, so the slider takes focus itself (keyboard steps after a click).
      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });
      e.currentTarget.setPointerCapture(e.pointerId);
      move(at(e));
    },
    onPointerMove: (e: PointerEvent) => {
      if (disabled) return;
      setHover(at(e));
      if (drag !== null) move(at(e));
    },
    onPointerUp: (e: PointerEvent) => {
      if (drag === null) return;
      onCommit(at(e));
      setDrag(null);
    },
    onPointerLeave: () => setHover(null),
    // Capture lost without a release (window switch, touch cancel): the drag ends where it was, uncommitted.
    onPointerCancel: () => setDrag(null),
  };
  return { ref, drag, hover, shown, pct, handlers };
}

/**
 * Thin track with a thumb that appears on hover/drag (Classic), or the M3 Expressive slider. `onChange` fires live
 * while dragging when `live` is set, otherwise only `onCommit` fires on release.
 */
export default function Slider(props: SliderProps) {
  return useUiStyle() === "m3" ? <M3Slider {...props} /> : <ClassicSlider {...props} />;
}

function ClassicSlider(props: SliderProps) {
  const { max, label, format, tooltip = "hover", disabled, className = "" } = props;
  const { ref, drag, hover, shown, handlers } = useSliderInput(props);
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={format?.(shown)}
      aria-disabled={disabled}
      {...handlers}
      className={`group relative flex h-4 cursor-pointer touch-none select-none items-center ${disabled ? "pointer-events-none opacity-40" : ""} ${className}`}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--c-slider-track)] group-hover:h-1.5">
        {hover !== null && max > 0 && <div className="absolute inset-0 origin-left bg-fg/20" style={{ transform: `scaleX(${hover / max})` }} />}
        {/* scaleX instead of width: no layout on every clock tick */}
        <div className="absolute inset-0 origin-left bg-[var(--c-slider-fill)]" style={{ transform: "scaleX(var(--f))" }} />
      </div>
      <div
        className={`absolute h-3 w-3 -translate-x-1/2 rounded-full bg-[var(--c-accent)] shadow ${drag !== null ? "block" : "hidden group-hover:block group-focus-visible:block"}`}
        style={{ left: "calc(var(--p) * 1%)" }}
      />
      {(hover !== null || drag !== null) && format && max > 0 && (
        <div className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-[var(--c-surface-3)] px-2 py-1 text-xs tabular-nums shadow whitespace-nowrap"
          style={{ left: `${((hover ?? shown) / max) * 100}%` }}>
          {format(tooltip === "value" ? shown : hover ?? shown)}
        </div>
      )}
    </div>
  );
}

/** Track height, handle height, track corner and the gap around the handle, in px (docs/dev/m3-expressive.md). */
const M3_SIZES = { xs: [16, 44, 8, 6], sm: [12, 32, 6, 4], seek: [4, 16, 2, 4] } as const;

/**
 * M3 Expressive slider: active and inactive tracks with a gap around a vertical bar handle. The tracks are
 * full-width layers cut with clip-path, so a clock tick only repaints; nothing is laid out again.
 */
function M3Slider(props: SliderProps) {
  const { max, label, format, tooltip = "hover", disabled, className = "", size = "xs", wavy } = props;
  const { ref, drag, hover, shown, pct, handlers } = useSliderInput(props);
  const [track, handle, corner, gap] = M3_SIZES[size];
  const dragging = drag !== null;
  // The handle narrows while held (M3 pressed state); the gap follows its edges.
  const hw = dragging ? 2 : 4;
  const edge = gap + hw / 2;
  const inner = Math.min(2, corner);
  const showTip = (hover !== null || dragging) && format && max > 0;
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={format?.(shown)}
      aria-disabled={disabled}
      {...handlers}
      className={`m3-slider group relative flex cursor-pointer touch-none select-none items-center ${disabled ? "pointer-events-none opacity-40" : ""} ${className}`}
      style={{ height: handle }}
    >
      {/* Inactive track, from the handle's right gap to the end, with the stop indicator at its end. The indicator is
          inside it, so the same clip hides it once the handle (and its gap) reaches it, at 100 %. */}
      <div className="absolute inset-x-0 bg-[var(--m3-secondary-container)]"
        style={{ height: track, clipPath: `inset(0 0 0 calc(var(--p) * 1% + ${edge}px) round ${inner}px ${corner}px ${corner}px ${inner}px)` }}>
        {size !== "seek" && <div className="absolute rounded-full bg-[var(--m3-primary)]" style={{ width: 4, height: 4, right: (track - 4) / 2, top: (track - 4) / 2 }} />}
      </div>
      {wavy !== undefined && size === "seek" ? (
        <Wave pct={pct} edge={edge} on={wavy} />
      ) : (
        <div className="absolute inset-x-0 bg-[var(--m3-primary)]"
          style={{ height: track, clipPath: `inset(0 calc((100 - var(--p)) * 1% + ${edge}px) 0 0 round ${corner}px ${inner}px ${inner}px ${corner}px)` }} />
      )}
      <div className="absolute rounded-full bg-[var(--m3-primary)]" style={{ left: `calc(var(--p) * 1% - ${hw / 2}px)`, width: hw, height: handle }} />
      {showTip && (
        <div className="m3-tooltip pointer-events-none absolute -translate-x-1/2 whitespace-nowrap tabular-nums"
          style={{ left: `${((tooltip === "value" ? shown : hover ?? shown) / max) * 100}%`, bottom: handle + 4 }}>
          {format(tooltip === "value" ? shown : hover ?? shown)}
        </div>
      )}
    </div>
  );
}

const WAVELENGTH = 40;
const AMPLITUDE = 3;
/** Seconds for the wave to travel one wavelength. */
const PERIOD = 1 / 0.6;
/** "Flat": a zero scale would make the transform singular and the stroke vanish. */
const FLAT = 0.001;
/** Wide enough for any seek bar; the path is built once. */
const WAVE_WIDTH = 3200;
const WAVE_PATH = (() => {
  let d = "M0 0";
  for (let x = 2; x <= WAVE_WIDTH + WAVELENGTH; x += 2) d += `L${x} ${(-Math.sin((2 * Math.PI * x) / WAVELENGTH)).toFixed(3)}`;
  return d;
})();

/** Whether the app window has focus (a blur when another window comes to the front). */
function useWindowFocused() {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return focused;
}

/** GPU rendering on (Settings → Advanced); asked once. Without it a moving wave would repaint on the main thread. */
let gpu: boolean | null = null;
const gpuAsked = invoke<boolean>("render_get_gpu").then((v) => (gpu = v !== false), () => (gpu = true));
function useGpu() {
  const [on, setOn] = useState(gpu ?? true);
  useEffect(() => void gpuAsked.then(() => setOn(gpu ?? true)), []);
  return on;
}

/**
 * Wavy active track (M3 Expressive progress): one static SVG sine, cut at the playhead by the same clip as the flat
 * track. It travels toward the start with an endless CSS animation on its own layer, which the compositor runs off
 * the main thread (an endless animation never ends, so WebKitGTK's end-of-animation flash can't happen; it only
 * pauses). It moves only while playing with the window focused and GPU rendering on; the amplitude springs to 0
 * when playback pauses, and with animations off it stays flat.
 */
function Wave({ pct, edge, on: playing }: { pct: number; edge: number; on: boolean }) {
  // With animations off the track stays flat: a wave that can't move would only look broken.
  const animations = useSettings((s) => s.appearance.animations);
  const on = playing && animations;
  const focused = useWindowFocused();
  const gpuOn = useGpu();
  const travel = on && focused && gpuOn;
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const g = useRef<SVGGElement>(null);
  const caps = useRef<(HTMLSpanElement | null)[]>([]);
  const [width, setWidth] = useState(0);
  const h = AMPLITUDE * 2 + 6;
  // The wave is cut 2 px inside its ends; a round cap sits on each cut.
  const startX = 2;
  const endX = (width * pct) / 100 - edge - 2;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Each cap bobs with the wave under it: an eased alternate (≈ a sine, -3 → +3 px over half a period). Settled at
  // full height, its animation runs on the compositor with its time set from the wave's, so they stay in step
  // wherever the cut is. While the height springs (play / pause) the cap animation is held and its time set every
  // frame to the pose of the wave at that height, so the caps rise and settle with it.
  const live = useRef({ amp: on ? 1 : 0, travel, xs: [0, 0] });
  live.current.travel = travel;
  live.current.xs = [startX, endX];
  const syncCaps = () => {
    const { amp, travel, xs } = live.current;
    const wave = svg.current?.getAnimations?.()[0];
    const t = Number(wave?.currentTime ?? 0);
    const full = PERIOD * 1000;
    xs.forEach((x, i) => {
      const el = caps.current[i];
      const cap = el?.getAnimations?.()[0];
      if (!el || !cap) return;
      const settled = amp >= 0.999;
      el.style.animationPlayState = settled && travel ? "running" : "paused";
      if (settled) {
        cap.currentTime = t + ((((x / WAVELENGTH - 0.25) % 1) + 1) % 1) * full;
        return;
      }
      // The wave's height here, as a fraction of the cap's full swing, turned into the time of that pose.
      const y = -amp * Math.sin((2 * Math.PI * x) / WAVELENGTH + (2 * Math.PI * t) / full);
      cap.currentTime = (full / (2 * Math.PI)) * Math.acos(Math.max(-1, Math.min(1, -y)));
    });
  };
  // The amplitude scales the wave's height inside the SVG; the stroke keeps its width.
  useSpring(on ? 1 : 0, "defaultSpatial", (a) => {
    g.current?.setAttribute("transform", `translate(0 ${h / 2}) scale(1 ${Math.max(FLAT, a * AMPLITUDE).toFixed(3)})`);
    live.current.amp = Math.max(0, a);
    syncCaps();
  });
  useLayoutEffect(syncCaps);
  // No caps until some wave shows past the start cut (the first seconds of a long song).
  const shown = endX > startX + 2;
  const capStyle = (x: number) => ({ left: x - 2, top: "calc(50% - 2px)", animationDuration: `${PERIOD / 2}s` });
  return (
    <>
      <div ref={box} className="pointer-events-none absolute left-0 w-full overflow-hidden text-[var(--m3-primary)]" aria-hidden
        style={{ height: h, clipPath: `inset(0 calc((100 - var(--p)) * 1% + ${edge + 2}px) 0 ${startX}px)` }}>
        <svg ref={svg} className="m3-wave" width={WAVE_WIDTH + WAVELENGTH} height={h} style={{ animationDuration: `${PERIOD}s`, animationPlayState: travel ? "running" : "paused" }}>
          <g ref={g} transform={`translate(0 ${h / 2}) scale(1 ${on ? AMPLITUDE : FLAT})`}>
            <path d={WAVE_PATH} fill="none" stroke="currentColor" strokeWidth={4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
      </div>
      {[startX, endX].map((x, i) => (
        <span key={i} ref={(el) => void (caps.current[i] = el)} aria-hidden
          className={`m3-wave-cap pointer-events-none absolute h-1 w-1 rounded-full bg-[var(--m3-primary)] ${shown ? "" : "invisible"}`}
          style={capStyle(x)} />
      ))}
    </>
  );
}
