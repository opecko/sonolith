import { useEffect, useLayoutEffect, useRef } from "react";
import { Spring } from "./engine";
import type { SpringParams, SpringPreset } from "./spring";

/**
 * Springs a number toward `target` whenever it changes and hands each frame to `apply`, which writes styles
 * directly (no re-render per frame). The first value is applied before paint without animating.
 */
export function useSpring(target: number, spring: SpringPreset | SpringParams, apply: (v: number) => void, onRest?: () => void) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const restRef = useRef(onRest);
  restRef.current = onRest;
  const s = useRef<Spring | null>(null);
  useLayoutEffect(() => {
    if (!s.current) {
      s.current = new Spring(target, spring, (v) => applyRef.current(v));
      applyRef.current(target);
      return;
    }
    s.current.to(target, () => restRef.current?.(), spring);
  }, [target]);
  useEffect(() => () => s.current?.stop(), []);
  return s;
}
