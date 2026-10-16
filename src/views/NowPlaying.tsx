import { ChevronDown } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useNav } from "../stores/nav";
import { usePlayer } from "../stores/player";
import { setAppearance, useSettings } from "../stores/settings";
import type { NowPlayingLayout } from "../theme/appearance";
import { Spring, tween } from "../motion";
import { UiStyleScope, useUiStyle } from "../components/UiStyle";
import { useUi } from "../stores/ui";
import BentoLayout from "./nowplaying/Bento";
import ClassicLayout from "./nowplaying/Classic";
import MaterialLayout from "./nowplaying/Material";

/**
 * Ambient light: the art is drawn once into a 12×12 canvas and stretched by the browser, which gives a soft blur
 * with no CSS filter. A static layer costs nothing to recomposite while the user hovers or scrolls above it.
 */
const AmbientLayer = memo(function AmbientLayer({ src, opacity }: { src: string; opacity: number }) {
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
      const ctx = ref.current?.getContext("2d");
      if (!ctx) return;
      // Two-step downscale averages more pixels than a single 1200→12 sample.
      const mid = document.createElement("canvas");
      mid.width = mid.height = 48;
      mid.getContext("2d")?.drawImage(img, 0, 0, 48, 48);
      ctx.drawImage(mid, 0, 0, 12, 12);
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
  }, [src]);
  return <canvas ref={ref} width={12} height={12} className="absolute inset-0 h-full w-full" />;
});

const Backdrop = memo(function Backdrop({ src, intensity }: { src?: string; intensity: number }) {
  const [layers, setLayers] = useState<string[]>(src ? [src] : []);
  useEffect(() => {
    if (src) setLayers((l) => (l.at(-1) === src ? l : [...l.slice(-1), src]));
  }, [src]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden will-change-transform" aria-hidden>
      {layers.map((l) => <AmbientLayer key={l} src={l} opacity={intensity} />)}
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
  const route = useNav((s) => s.route);
  // Stays mounted after closing until it has slid away (set during render, so no frame is lost).
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  const panel = useRef<HTMLDivElement>(null);
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
    <div ref={panel} role="dialog" aria-label="Now playing" aria-hidden={!open} data-ambient={ambientOn ? "" : undefined}
      className={`${open ? "" : "pointer-events-none"} fixed inset-x-0 ${layout === "bento" ? "bottom-0" : "bottom-[72px]"} top-0 z-30 flex bg-[var(--c-bg)] will-change-transform`}>
      {ambientOn && <Backdrop src={thumb} intensity={ambientIntensity} />}
      {/* One close button per layout: Bento replaces the player bar (and keeps this corner free for it); Material
          and Classic use the player bar's. */}
      {layout === "bento" && <button onClick={close} aria-label="Close now playing" className="icon-btn absolute left-4 top-3 z-10 h-10 w-10">
        <ChevronDown size={24} />
      </button>}
      {layout === "material" ? <MaterialLayout /> : layout === "bento" ? <BentoLayout /> : <ClassicLayout />}
      <TryLooksCard />
    </div>
  );
}
