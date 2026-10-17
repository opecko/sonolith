import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ticker, useSpring } from "../motion";
import { playheadTime, useVisiblePlayhead } from "../playback/playhead";
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
  /**
   * The seek bar: the fill and handle follow the smooth playhead every frame (straight to the DOM), `value` only
   * keeps the accessible value and the keyboard steps current.
   */
  playhead?: boolean;
}

/** Pointer, keyboard and hover handling shared by both looks. */
function useSliderInput({ value, max, onCommit, onChange, live = false, step, disabled, playhead }: SliderProps, onPct?: (pct: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;

  // The position is a CSS variable (--p 0–100, --f 0–1) on the root: React writes it on value changes, the playhead loop
  // every frame; a drag always wins.
  const state = useRef({ drag, max, onPct });
  state.current = { drag, max, onPct };
  const write = useCallback((p: number) => {
    ref.current?.style.setProperty("--p", String(p));
    ref.current?.style.setProperty("--f", String(p / 100));
    state.current.onPct?.(p);
  }, []);
  const follow = useCallback((sec: number) => {
    const { drag, max } = state.current;
    if (drag === null) write(max > 0 ? Math.min(100, Math.max(0, (sec / max) * 100)) : 0);
  }, [write]);
  // After every render: the React value, or (a playhead between its frames) the playhead now.
  useLayoutEffect(() => {
    if (!playhead || drag !== null) write(pct);
    else follow(playheadTime());
  });
  useVisiblePlayhead(ref, playhead && !disabled ? follow : null);

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

/** Track height, handle height, track corner and the gap around the handle, in px (docs/m3-expressive.md). */
const M3_SIZES = { xs: [16, 44, 8, 6], sm: [12, 32, 6, 4], seek: [4, 16, 2, 4] } as const;

/**
 * M3 Expressive slider: active and inactive tracks with a gap around a vertical bar handle. The tracks are
 * full-width layers cut with clip-path, so a clock tick only repaints; nothing is laid out again.
 */
function M3Slider(props: SliderProps) {
  const { max, label, format, tooltip = "hover", disabled, className = "", size = "xs", wavy } = props;
  // The wave is a canvas: it redraws when the position moves.
  const wave = useRef<((pct: number) => void) | null>(null);
  const { ref, drag, hover, shown, pct, handlers } = useSliderInput(props, (p) => wave.current?.(p));
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
        <Wave pct={pct} edge={edge} on={wavy} redraw={wave} />
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
/** Wavelengths per second the wave travels. */
const SPEED = 0.6;

/**
 * Wavy active track (M3 Expressive progress): a stroked sine on a canvas, drawn only on value changes and, while
 * playing and visible, at ~30 fps as the wave travels from the playhead toward the start. The amplitude springs to 0 when playback pauses; with
 * animations off it stays flat.
 */
function Wave({ pct, edge, on: playing, redraw }: { pct: number; edge: number; on: boolean; redraw: { current: ((pct: number) => void) | null } }) {
  // With animations off the track stays flat: a wave that can't move would only look broken.
  const animations = useSettings((s) => s.appearance.animations);
  const on = playing && animations;
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ phase: 0, amp: on ? 1 : 0, pct, edge, color: "", w: 0, h: 0, acc: 0 });
  st.current.edge = edge;

  const draw = () => {
    const c = ref.current, s = st.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !s.w) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    const end = (s.w * s.pct) / 100 - s.edge - 2;
    if (end <= 2) return;
    const mid = s.h / 2;
    ctx.beginPath();
    for (let x = 2; x <= end; x += 1.5) {
      // The wave grows in over the first half wavelength so the start stays on the track's line.
      const ramp = Math.min(1, (x - 2) / (WAVELENGTH / 2));
      // + phase: the crests travel leftward, out of the playhead toward the start (as on Android).
      ctx.lineTo(x, mid + AMPLITUDE * s.amp * ramp * Math.sin((2 * Math.PI * x) / WAVELENGTH + s.phase));
    }
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = s.color;
    ctx.stroke();
  };

  // Canvas size follows the element; the color is re-read on value changes (cover accent, palette switch).
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      st.current.w = c.clientWidth;
      st.current.h = c.clientHeight;
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
      draw();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    fit();
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (ref.current) st.current.color = getComputedStyle(ref.current).color;
    draw();
  }, [pct, edge]);
  // The playhead moves it between renders: drawn at once unless the travelling wave draws anyway.
  const travelling = useRef(on);
  travelling.current = on;
  useLayoutEffect(() => {
    redraw.current = (p) => {
      st.current.pct = p;
      if (!travelling.current) draw();
    };
    return () => void (redraw.current = null);
  });
  useSpring(on ? 1 : 0, "defaultSpatial", (a) => {
    st.current.amp = Math.max(0, a);
    draw();
  });
  useEffect(() => {
    if (!on) return;
    return ticker((dt) => {
      const s = st.current;
      s.phase = (s.phase + dt * SPEED * 2 * Math.PI) % (2 * Math.PI);
      // ~30 fps is plenty for a slow wave and halves the repaints.
      s.acc += dt;
      if (s.acc < 1 / 30) return;
      s.acc = 0;
      draw();
    });
  }, [on]);
  return <canvas ref={ref} className="pointer-events-none absolute left-0 w-full text-[var(--m3-primary)]" style={{ height: AMPLITUDE * 2 + 6 }} aria-hidden />;
}
