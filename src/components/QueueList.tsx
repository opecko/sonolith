import { AudioLines, GripVertical, Pause, Play } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Track } from "../api/types";
import { usePlayer } from "../stores/player";
import ItemMenu from "./ItemMenu";
import { fmtTime } from "./PlayerBar";
import Thumb from "./Thumb";
import { Byline } from "./TrackByline";

/** Pointer distance from the scroll box edge where dragging starts to auto-scroll, and the top speed (px/frame). */
const EDGE = 48;
const MAX_SPEED = 18;

type Drop = { i: number; pos: "before" | "after" };

interface RowProps {
  track: Track;
  i: number;
  current: boolean;
  played: boolean;
  playing: boolean;
  /** Drop indicator: line above or below this row. */
  drop: "before" | "after" | null;
  dragging: boolean;
  onHandleDown: (i: number, e: ReactPointerEvent<HTMLElement>) => void;
}

const Row = memo(function Row({ track, i, current, played, playing, drop, dragging, onHandleDown }: RowProps) {
  const { playIndex, togglePlay } = usePlayer.getState();
  return (
    <li
      data-index={i}
      data-current={current || undefined}
      className={`m3-row group relative flex items-center rounded-[var(--radius)] pr-1 hover:bg-[var(--c-hover)] ${current ? "bg-[var(--c-hover)]" : ""} ${played && !current ? "opacity-60" : ""} ${dragging ? "opacity-40" : ""}`}
    >
      {drop && <span className={`pointer-events-none absolute inset-x-2 h-0.5 rounded bg-[var(--c-accent)] ${drop === "before" ? "-top-px" : "-bottom-px"}`} />}
      <span
        aria-label={`Drag to reorder ${track.title}`}
        title="Drag to reorder"
        onPointerDown={(e) => onHandleDown(i, e)}
        className={`relative z-[1] flex h-10 w-6 shrink-0 cursor-grab touch-none select-none items-center justify-center text-[var(--c-text-subtle)] hover:text-[var(--c-text)] active:cursor-grabbing group-hover:opacity-100 ${dragging ? "opacity-100" : "opacity-0"}`}
      >
        <GripVertical size={16} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pr-2">
        <span className="relative shrink-0">
          <Thumb src={track.thumbnail} px={40} className="h-10 w-10" />
          <span className={`m3-art absolute inset-0 flex items-center justify-center rounded-[var(--radius)] bg-scrim/60 ${current ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            {current ? (playing ? <><AudioLines size={18} className="group-hover:hidden" aria-hidden /><Pause size={18} fill="currentColor" className="hidden group-hover:block" aria-hidden /></> : <Play size={18} fill="currentColor" aria-hidden />) : <Play size={18} fill="currentColor" aria-hidden />}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          {/* Covers the row (row-hit): a click anywhere plays; the byline links sit above it. */}
          <button onClick={() => (current ? togglePlay() : playIndex(i))} aria-current={current ? "true" : undefined}
            className="row-hit block max-w-full truncate text-left text-sm font-medium">{track.title}</button>
          <span className="block truncate text-xs text-[var(--c-text-muted)]"><Byline track={track} text={track.artists.join(", ") || track.subtitle} /></span>
        </span>
        {track.explicit && <span className="rounded-sm bg-[var(--c-text-subtle)] px-1 text-[10px] font-bold text-[var(--c-bg)]" aria-label="Explicit">E</span>}
        {track.durationSec !== undefined && <span className="text-xs tabular-nums text-[var(--c-text-muted)]">{fmtTime(track.durationSec)}</span>}
      </div>
      <ItemMenu item={track} queueIndex={i} className="relative opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
    </li>
  );
});

/**
 * Whole queue (played tracks stay, dimmed). Keeps the playing track first or second in view, separates autoplay
 * additions with a divider, and reorders by dragging the handle (pointer events, auto-scrolls near the edges). Never subscribes to the playback clock.
 */
export default function QueueList({ autoScroll = false }: { autoScroll?: boolean }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.status === "playing");
  const loading = usePlayer((s) => s.chipLoading);
  const ref = useRef<HTMLOListElement>(null);
  const firstScroll = useRef(true);
  const [dropAt, setDropAt] = useState<Drop | null>(null);
  const [dragFrom, setDragFrom] = useState(-1);
  const currentId = queue[index]?.id;

  const indexRef = useRef(index);
  indexRef.current = index;
  // When the playing track changes (not on reorders), scroll so the previous track sits at the top: the current one
  // is the second visible row. The browser clamps at the end of the list.
  useLayoutEffect(() => {
    const index = indexRef.current;
    if (!autoScroll || index < 0) return;
    const list = ref.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${Math.max(index - 1, 0)}"]`);
    const box = list?.closest<HTMLElement>(".scroll-y");
    if (!row || !box) return;
    const delta = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollBy({ top: delta, behavior: firstScroll.current ? "auto" : "smooth" });
    firstScroll.current = false;
  }, [autoScroll, currentId]);

  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  // Pointer-driven reorder (native HTML5 drag is unreliable in WebKitGTK: no auto-scroll, flickering drop targets).
  // The handle captures the pointer; the drop slot is computed from the row rects, and the list scrolls near the edges.
  const onHandleDown = useCallback((from: number, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const list = ref.current;
    const box = list?.closest<HTMLElement>(".scroll-y");
    if (!list || !box) return;
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
      const r = box.getBoundingClientRect();
      const fromTop = y - r.top;
      const fromBottom = r.bottom - y;
      if (fromTop < EDGE) box.scrollTop -= MAX_SPEED * Math.min(1, (EDGE - fromTop) / EDGE);
      else if (fromBottom < EDGE) box.scrollTop += MAX_SPEED * Math.min(1, (EDGE - fromBottom) / EDGE);
      locate();
      raf = requestAnimationFrame(tick);
    };
    const end = (commit: boolean) => {
      cancelAnimationFrame(raf);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      stopDrag.current = null;
      setDropAt(null);
      setDragFrom(-1);
      if (!commit || !target) return;
      // Insertion point in the original list, then account for the removed source row.
      let to = target.pos === "before" ? target.i : target.i + 1;
      if (from < to) to -= 1;
      if (to !== from) usePlayer.getState().moveTrack(from, to);
    };
    const move = (ev: PointerEvent) => void (y = ev.clientY);
    const up = () => end(true);
    const cancel = () => end(false);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    stopDrag.current = cancel;
    setDragFrom(from);
    locate();
    raf = requestAnimationFrame(tick);
  }, []);

  if (!queue.length) return <p className="px-2 text-sm text-[var(--c-text-subtle)]">Queue is empty. Play something to fill it.</p>;
  const firstAutoplay = queue.findIndex((t) => t.source === "autoplay");
  return (
    <ol ref={ref} className={`${dragFrom >= 0 ? "select-none" : ""} ${loading ? "pointer-events-none opacity-40" : ""}`} aria-busy={loading}>
      {queue.map((track, i) => (
        <QueueRowWithDivider key={`${track.id}:${i}`} divider={i === firstAutoplay}>
          <Row
            track={track}
            i={i}
            current={i === index}
            played={i < index}
            // Only the current row shows play state; others keep a stable prop so memo skips them on play/pause.
            playing={i === index && playing}
            drop={dropAt?.i === i ? dropAt.pos : null}
            dragging={dragFrom === i}
            onHandleDown={onHandleDown}
          />
        </QueueRowWithDivider>
      ))}
    </ol>
  );
}

function QueueRowWithDivider({ divider, children }: { divider: boolean; children: React.ReactNode }) {
  if (!divider) return <>{children}</>;
  return (
    <>
      <li role="separator" className="mx-2 mb-2 mt-3 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-[var(--c-text-subtle)]">
        <span className="h-px flex-1 bg-[var(--c-outline)]" />
        Autoplay
        <span className="h-px flex-1 bg-[var(--c-outline)]" />
      </li>
      {children}
    </>
  );
}
