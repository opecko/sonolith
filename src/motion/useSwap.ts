import { useLayoutEffect, useRef } from "react";
import { Spring } from "./engine";

/**
 * Content swap (Bento's Up next ↔ Related, Material's panel tabs, the onboarding steps): the new content slides in
 * from the side it lives on and fades up, on a spring written per frame (instant with animations off). The first
 * render doesn't animate, nor does a change while `enabled` is false (e.g. a panel that is opening anyway).
 */
export function useSwap(key: string, dir: number, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el || !enabled) return;
    const s = new Spring(0, "defaultSpatial", (p) => {
      el.style.opacity = String(Math.min(1, Math.max(0, p)));
      el.style.transform = `translateX(${Math.round((1 - p) * 24 * dir * 10) / 10}px)`;
    }, { precision: 0.002 });
    s.set(0);
    s.to(1, () => {
      el.style.opacity = "";
      el.style.transform = "";
    });
    return () => s.stop();
  }, [key]);
  return ref;
}
