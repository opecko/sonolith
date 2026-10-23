import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { setCoverScope } from "../stores/coverColors";
import { useNav } from "../stores/nav";
import { usePlayer } from "../stores/player";
import { setAppearance, useSettings } from "../stores/settings";
import type { AmbientQuality, NowPlayingLayout } from "../theme/appearance";
import { Spring, tween } from "../motion";
import { UiStyleScope, useUiStyle } from "../components/UiStyle";
import { useUi } from "../stores/ui";
import BentoLayout from "./nowplaying/Bento";
import ClassicLayout from "./nowplaying/Classic";
import MaterialLayout from "./nowplaying/Material";

/** Ambient quality → [colors sampled across the art, canvas size]. */
const AMBIENT: Record<AmbientQuality, [number, number]> = { low: [12, 12], medium: [16, 128], high: [24, 384] };

/**
 * Paints the ambient light once: the art averaged down to a few colors (two steps, so more pixels count), then for
 * Medium and High scaled back up in smoothing steps of at most 2.5× each, which spreads every color into soft
 * gradients with no blocks and no blur filter. Low is the small grid stretched by the browser, as before 2.0.
 */
function paintAmbient(canvas: HTMLCanvasElement, img: HTMLImageElement, quality: AmbientQuality) {
  const t0 = performance.now();
  const [sample, size] = AMBIENT[quality];
  const step = (from: CanvasImageSource, w: number) => {
    const c = document.createElement("canvas");
    c.width = c.height = w;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(from, 0, 0, w, w);
    return c;
  };
  let cur = step(step(img, 64), sample);
  for (let w = sample; w < size; ) {
    w = Math.min(size, Math.round(w * 2.5));
    cur = step(cur, w);
  }
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, 0, 0);
  performance.measure(`ambient-paint-${quality}`, { start: t0, end: performance.now() });
}

/**
 * Ambient light: the art painted once per cover into a small canvas (see paintAmbient) and stretched by the
 * browser, a soft glow with no CSS filter. A static layer costs nothing to recomposite while the user hovers or
 * scrolls above it, and it only exists while Now Playing is open.
 */
const AmbientLayer = memo(function AmbientLayer({ src, opacity, quality }: { src: string; opacity: number; quality: AmbientQuality }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const target = useRef(opacity);
  // Fade-in progress 0–1. Driven from JS like the overlay's slide: a CSS animation's last frame on WebKitGTK
  // flashes the layer's pre-animation opacity (the ambient light blinking off).
  const shown = useRef(0);
  const paint = () => {
    if (ref.current) ref.current.style.opacity = String(target.current * shown.current);
  };
  useLayoutEffect(() => {
    target.current = opacity;
    paint();
  }, [opacity]);
  useEffect(() => {
    let cancel = () => {};
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      if (!ref.current) return;
      paintAmbient(ref.current, img, quality);
      cancel = tween(300, (t) => 1 - (1 - t) ** 3, (p) => {
        shown.current = p;
        paint();
      });
    };
    img.src = src;
    return () => {
      img.onload = null;
      cancel();
    };
  }, [src, quality]);
  return <canvas ref={ref} width={12} height={12} className="absolute inset-0 h-full w-full" />;
});

const Backdrop = memo(function Backdrop({ src, intensity, quality }: { src?: string; intensity: number; quality: AmbientQuality }) {
  const [layers, setLayers] = useState<string[]>(src ? [src] : []);
  useEffect(() => {
    if (src) setLayers((l) => (l.at(-1) === src ? l : [...l.slice(-1), src]));
  }, [src]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden will-change-transform" aria-hidden>
      {layers.map((l) => <AmbientLayer key={l} src={l} opacity={intensity} quality={quality} />)}
      <div className="absolute inset-0 bg-[var(--c-overlay)]" />
    </div>
  );
});

/**
 * Slides the overlay out from behind the player bar and back, driven from JS one frame at a time. WebKitGTK runs CSS
 * animations on the compositor and, when one ends, paints a frame with the layer's pre-animation transform: the
 * closed overlay right after opening, the open one right after closing. Setting the transform every frame from the
 * main thread leaves nothing stale to show. Position is in % of the overlay's height (100 = hidden).
 */
function useSlide(ref: RefObject<HTMLDivElement | null>, open: boolean, onOpened: () => void, onClosed: () => void, m3: boolean) {
  const pos = useRef(100);
  const spring = useRef<Spring | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (m3) {
      // M3: a critically damped slow spatial spring (no overshoot: the overlay must not lift off the player bar).
      el.style.transform = `translateY(${pos.current}%)`;
      spring.current ??= new Spring(pos.current, { damping: 1, stiffness: 240 }, (y) => {
        pos.current = y;
        el.style.transform = `translateY(${y}%)`;
      }, { precision: 0.05 });
      spring.current.to(open ? 0 : 100, () => {
        if (open) return onOpened();
        spring.current = null;
        onClosed();
      });
      return;
    }
    const from = pos.current;
    const [to, ms, ease] = open
      ? [0, 200, (t: number) => 1 - (1 - t) ** 4] // like cubic-bezier(0.2, 0, 0, 1)
      : [100, 160, (t: number) => t * t];
    // Before the first paint, so the overlay never shows at its final place first.
    el.style.transform = `translateY(${from}%)`;
    return tween(ms, ease, (p) => {
      pos.current = from + (to - from) * p;
      el.style.transform = `translateY(${pos.current}%)`;
    }, open ? onOpened : onClosed);
    // The callbacks only run at the end; re-running for new ones would restart the slide.
  }, [open]);
}

const LAYOUTS: { id: NowPlayingLayout; label: string }[] = [{ id: "material", label: "Material" }, { id: "bento", label: "Bento" }, { id: "classic", label: "Classic" }];

/** "Try out the new looks" (from What's new): switch layouts in place, then dismiss. Always M3. */
function TryLooksCard() {
  const on = useUi((s) => s.tryLooks);
  const layout = useSettings((s) => s.appearance.nowPlayingLayout);
  if (!on) return null;
  return (
    <UiStyleScope value="m3" className="pointer-events-none absolute inset-x-0 top-4 z-40 flex justify-center px-20">
      <div role="region" aria-label="Try out the new looks"
        className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-3 rounded-[var(--m3-corner-xl)] bg-[var(--m3-surface-container-high)] px-5 py-3 text-[var(--m3-on-surface)] shadow-[0_4px_16px_color-mix(in_srgb,var(--m3-scrim)_30%,transparent)]">
        <p className="type-title-medium-em">Try out the new looks</p>
        <div className="m3-segmented flex" role="group" aria-label="Now Playing layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} className="m3-seg" aria-pressed={layout === l.id} onClick={() => setAppearance({ nowPlayingLayout: l.id })}>{l.label}</button>
          ))}
        </div>
        <button className="m3-btn m3-filled h-10" onClick={() => useUi.getState().setTryLooks(false)}>I tried it</button>
      </div>
    </UiStyleScope>
  );
}

/** Full-window overlay above the content but below the player bar; playback state is untouched. */
export default function NowPlaying() {
  const open = useUi((s) => s.nowPlaying);
  const close = () => useUi.getState().setNowPlaying(false);
  const thumb = usePlayer((s) => s.queue[s.index]?.thumbnail);
  // Ambient light (Settings → Appearance); when off it is neither computed nor drawn, the overlay shows --c-bg.
  const ambientOn = useSettings((s) => s.appearance.ambient);
  const ambientIntensity = useSettings((s) => s.appearance.ambientIntensity);
  const ambientQuality = useSettings((s) => s.appearance.ambientQuality);
  const route = useNav((s) => s.route);
  // Stays mounted after closing until it has slid away (set during render, so no frame is lost).
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const panel = useRef<HTMLDivElement>(null);
  // "Colors from album art" for Now Playing only themes this element (while it's mounted).
  const panelRef = useCallback((el: HTMLDivElement | null) => {
    panel.current = el;
    setCoverScope(el);
  }, []);
  const m3 = useUiStyle() === "m3";
  const layout = useSettings((s) => s.appearance.nowPlayingLayout);
  useSlide(panel, open, () => useUi.getState().setNowPlayingCovering(true), () => {
    setMounted(false);
    useUi.getState().setTryLooks(false);
  }, m3);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="menu"]') && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // Navigating from inside (Related cards, menus) shows the target page.
  useEffect(() => {
    close();
  }, [route]);

  if (!mounted) return null;
  return (
    <div ref={panelRef} role="dialog" aria-label="Now playing" aria-hidden={!open} data-ambient={ambientOn ? "" : undefined}
      className={`${open ? "" : "pointer-events-none"} fixed inset-x-0 ${layout === "classic" ? "bottom-[72px]" : "bottom-0"} top-0 z-30 flex bg-[var(--c-bg)] will-change-transform`}>
      {ambientOn && <Backdrop src={thumb} intensity={ambientIntensity} quality={ambientQuality} />}
      {/* One close button per layout: Classic uses the player bar's; Material and Bento, which replace the bar, put
          theirs bottom right in space they keep free for it (CloseNowPlaying). */}
      {layout === "material" ? <MaterialLayout /> : layout === "bento" ? <BentoLayout /> : <ClassicLayout />}
      <TryLooksCard />
    </div>
  );
}
