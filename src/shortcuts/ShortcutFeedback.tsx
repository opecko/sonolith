import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUiStyle } from "../components/UiStyle";
import { Spring } from "../motion";
import { usePlayer } from "../stores/player";
import { useShortcutUi } from "./store";

const iconFor = (level: number, muted: boolean) => (muted || level === 0 ? VolumeX : level < 50 ? Volume1 : Volume2);

/** The volume a shortcut just set, for when no volume control is on screen (or it's out of sight). */
export default function ShortcutFeedback() {
  return useUiStyle() === "m3" ? <M3VolumeBubble /> : <ClassicVolumeBubble />;
}

function ClassicVolumeBubble() {
  const volume = useShortcutUi((s) => s.volume);
  if (volume === null) return null;
  const level = Math.round(volume * 100);
  const Icon = iconFor(level, false);
  return (
    <div role="status" className="pointer-events-none fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] px-4 py-2.5 text-sm tabular-nums shadow-2xl">
      <Icon size={18} aria-hidden /> Volume {level} %
    </div>
  );
}

/**
 * M3 Expressive: an inverse-surface pill with the speaker icon, a short linear progress and the value. It grows in
 * from its anchor (bottom center) on a spring, the bar follows the level on a spring, and it shrinks away once the
 * store hides it; a new change while it's up only moves the bar (the store restarts the hide timer). All per frame
 * from the motion engine, instant with animations off.
 */
function M3VolumeBubble() {
  const volume = useShortcutUi((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  // Kept while the exit runs: the last value shown.
  const [shown, setShown] = useState<number | null>(volume);
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const enter = useRef<Spring | null>(null);
  const level = useRef<Spring | null>(null);

  if (volume !== null && volume !== shown) setShown(volume);

  // Enter / exit: scale from 0.6 and fade, both written per frame.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    enter.current ??= new Spring(0, "fastSpatial", (p) => {
      const c = Math.max(0, Math.min(1, p));
      el.style.opacity = String(c);
      // The `scale` property, apart from the centering translate (a class), so clearing it never moves the bubble.
      el.style.scale = String(0.6 + 0.4 * p);
    }, { precision: 0.002 });
    if (volume !== null) {
      enter.current.to(1, () => {
        el.style.opacity = "";
        el.style.scale = "";
      }, "fastSpatial");
    } else {
      enter.current.to(0, () => {
        // The element goes away: the next bubble is a new one with its own springs.
        enter.current = level.current = null;
        setShown(null);
      }, "defaultEffects");
    }
  }, [volume === null, shown === null]);

  // The bar follows the level.
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el || shown === null) return;
    if (!level.current) {
      level.current = new Spring(shown, "fastSpatial", (v) => (el.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`), { precision: 0.001 });
      el.style.width = `${shown * 100}%`;
    } else level.current.to(shown);
  }, [shown, shown === null]);

  useEffect(() => () => {
    enter.current?.stop();
    level.current?.stop();
  }, []);

  if (shown === null) return null;
  const pct = Math.round(shown * 100);
  const Icon = iconFor(pct, muted);
  return (
    <div ref={root} role="status" aria-label={`Volume ${pct} %`}
      className="pointer-events-none fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full bg-[var(--m3-inverse-surface)] py-3 pl-4 pr-5 text-[var(--m3-inverse-on-surface)] shadow-[0_4px_12px_color-mix(in_srgb,var(--m3-scrim)_30%,transparent)]"
      style={{ transformOrigin: "50% 100%", opacity: 0, scale: "0.6" }}>
      <Icon size={20} className="text-[var(--m3-inverse-primary)]" aria-hidden />
      <div className="relative h-1 w-28 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--m3-inverse-on-surface)_24%,transparent)]" aria-hidden>
        <div ref={bar} className="absolute inset-y-0 left-0 rounded-full bg-[var(--m3-inverse-primary)]" />
      </div>
      <span className="type-label-large w-11 text-right tabular-nums">{pct} %</span>
    </div>
  );
}
