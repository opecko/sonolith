// Motion for recap cards, on the shared motion engine (src/motion): one tween per card entrance that writes styles
// straight to elements (no React state per frame), finished at once with animations off or while hidden. Never CSS
// transform/opacity animations: WebKitGTK flashes the first frame when those end.
import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { motionOn, ticker, tween } from "../../motion";

export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** A little overshoot, for things that land. */
export const easeBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Local progress of item `i` of `n` when items start one after another across `spread` (0–1) of the whole. */
export const stagger = (p: number, i: number, n: number, spread = 0.5) => {
  const each = 1 - spread;
  const start = n > 1 ? (spread * i) / (n - 1) : 0;
  return clamp01((p - start) / each);
};

/** `calc(var(--u) * n)`: card units (the card is designed at 360 × 640 and scaled as a whole). */
export const U = (n: number) => `calc(var(--u) * ${n})`;

/**
 * Runs an entrance: `frame(p)` with p from 0 to 1 over `ms`, then once more at 1. Runs before paint (no flash of the
 * final state), and only the end state with animations off.
 */
export function useEntrance(ms: number, frame: (p: number) => void, deps: unknown[] = []) {
  const f = useRef(frame);
  f.current = frame;
  const entering = useContext(EntranceHold);
  useLayoutEffect(() => {
    f.current(motionOn() ? 0 : 1);
    // Auto-advance waits while the entrance plays (typing, printing, counting), so a card is never cut short.
    let held = motionOn();
    if (held) entering(1);
    const release = () => {
      if (held) entering(-1);
      held = false;
    };
    const stop = tween(ms, (t) => t, (p) => f.current(p), release);
    return () => {
      stop();
      release();
    };
  }, deps);
}

/** The player's count of entrances still playing (+1 when one starts, −1 when it ends or unmounts). */
export const EntranceHold = createContext<(delta: number) => void>(() => {});

/** A loop for an active card (marquee, shimmer); stops on unmount, while hidden and with animations off. */
export function useLoop(fn: (dt: number) => void, on = true) {
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => (on ? ticker((dt) => f.current(dt)) : undefined), [on]);
}

/** All elements under `root` with `data-e` (cached per entrance). */
export const parts = (root: HTMLElement | null, name = "") =>
  root ? Array.from(root.querySelectorAll<HTMLElement>(name ? `[data-e="${name}"]` : "[data-e]")) : [];

/** Count-up text: formats `value × p` into the element. */
export function countTo(el: HTMLElement | null | undefined, value: number, p: number, format: (n: number) => string) {
  if (el) el.textContent = format(p >= 1 ? value : value * easeOut(p));
}
