import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

/** Pointer distance from the scroll box edge where dragging starts to auto-scroll, and the top speed (px/frame). */
const EDGE = 48;
const MAX_SPEED = 18;

export type Drop = { i: number; pos: "before" | "after" };

/** Where an item dragged from `from` lands for a drop slot: the slot in the original list, minus the removed item. */
export function dropIndex(from: number, target: Drop): number {
  const to = target.pos === "before" ? target.i : target.i + 1;
  return from < to ? to - 1 : to;
}

/** A copy of `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/**
 * Pointer-driven drag to reorder a list (the Up next queue, Settings → Lyrics providers). Native HTML5 drag is
 * unreliable in WebKitGTK (no auto-scroll, flickering drop targets): the handle captures the pointer, the drop slot
 * comes from the rows' rects (`li[data-index]` inside `ref`), and the nearest `.scroll-y` box scrolls near its edges.
 * Alt+↑ / Alt+↓ on a handle moves its item by one (`onHandleKey`).
 */
export function useDragReorder<T extends HTMLElement>(onMove: (from: number, to: number) => void) {
  const ref = useRef<T>(null);
  const [dropAt, setDropAt] = useState<Drop | null>(null);
  const [dragFrom, setDragFrom] = useState(-1);
  const move = useRef(onMove);
  move.current = onMove;
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  const onHandleDown = useCallback((from: number, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const list = ref.current;
    if (!list) return;
    const box = list.closest<HTMLElement>(".scroll-y");
    let y = e.clientY;
    let target: Drop | null = null;
    let raf = 0;

    const locate = () => {
      const rows = Array.from(list.querySelectorAll<HTMLElement>("li[data-index]"));
      let next: Drop | null = null;
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          next = { i: Number(row.dataset.index), pos: "before" };
          break;
        }
      }
      if (!next && rows.length) next = { i: Number(rows[rows.length - 1].dataset.index), pos: "after" };
      if (next?.i !== target?.i || next?.pos !== target?.pos) {
        target = next;
        setDropAt(next);
      }
    };
    const tick = () => {
      if (box) {
        const r = box.getBoundingClientRect();
        const fromTop = y - r.top;
        const fromBottom = r.bottom - y;
        if (fromTop < EDGE) box.scrollTop -= MAX_SPEED * Math.min(1, (EDGE - fromTop) / EDGE);
        else if (fromBottom < EDGE) box.scrollTop += MAX_SPEED * Math.min(1, (EDGE - fromBottom) / EDGE);
      }
      locate();
      raf = requestAnimationFrame(tick);
    };
    const end = (commit: boolean) => {
      cancelAnimationFrame(raf);
      handle.removeEventListener("pointermove", pmove);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      stopDrag.current = null;
      setDropAt(null);
      setDragFrom(-1);
      if (!commit || !target) return;
      const to = dropIndex(from, target);
      if (to !== from) move.current(from, to);
    };
    const pmove = (ev: PointerEvent) => void (y = ev.clientY);
    // The slot where the pointer is let go, even if no frame ran since it last moved (a quick flick).
    const up = (ev: PointerEvent) => {
      y = ev.clientY;
      locate();
      end(true);
    };
    const cancel = () => end(false);
    handle.addEventListener("pointermove", pmove);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    stopDrag.current = cancel;
    setDragFrom(from);
    locate();
    raf = requestAnimationFrame(tick);
  }, []);

  /** Alt+↑ / Alt+↓ on a focused handle: one place up or down (`count` items in the list). */
  const onHandleKey = useCallback((i: number, count: number, e: KeyboardEvent<HTMLElement>) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const to = e.key === "ArrowUp" ? i - 1 : i + 1;
    e.preventDefault();
    if (to < 0 || to >= count) return;
    move.current(i, to);
  }, []);

  return { ref, dropAt, dragFrom, onHandleDown, onHandleKey };
}
