import { AudioLines, GripVertical, Pause, Play } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Track } from "../api/types";
import { usePlayer } from "../stores/player";
import ItemMenu from "./ItemMenu";
import { fmtTime } from "./PlayerBar";
import Thumb from "./Thumb";
import { Byline, rowPlayClick } from "./TrackByline";
import { useDragReorder } from "../hooks/useDragReorder";


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
  onHandleKey: (i: number, e: ReactKeyboardEvent<HTMLElement>) => void;
}

const Row = memo(function Row({ track, i, current, played, playing, drop, dragging, onHandleDown, onHandleKey }: RowProps) {
  return (
    <li
      data-index={i}
      data-current={current || undefined}
      className={`m3-row group relative flex items-center rounded-[var(--radius)] pr-1 hover:bg-[var(--c-hover)] ${current ? "bg-[var(--c-hover)]" : ""} ${played && !current ? "opacity-60" : ""} ${dragging ? "opacity-40" : ""}`}
    >
      {drop && <span className={`pointer-events-none absolute inset-x-2 h-0.5 rounded bg-[var(--c-accent)] ${drop === "before" ? "-top-px" : "-bottom-px"}`} />}
      <span
        role="button"
        tabIndex={0}
        aria-label={`Reorder ${track.title} (drag, or Alt+Up / Alt+Down)`}
        title="Drag to reorder (Alt+↑ / Alt+↓)"
        onPointerDown={(e) => onHandleDown(i, e)}
        onKeyDown={(e) => onHandleKey(i, e)}
        data-no-play=""
        className={`flex h-10 w-6 shrink-0 cursor-grab touch-none select-none items-center justify-center text-[var(--c-text-subtle)] hover:text-[var(--c-text)] focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100 ${dragging ? "opacity-100" : "opacity-0"}`}
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
          {/* The list plays (or pauses) a row clicked anywhere but on its controls; the title is its keyboard target. */}
          <button data-play="" aria-current={current ? "true" : undefined} className="block max-w-full truncate text-left text-sm font-medium">{track.title}</button>
          <span className="block truncate text-xs text-[var(--c-text-muted)]"><Byline track={track} text={track.artists.join(", ") || track.subtitle} /></span>
        </span>
        {track.explicit && <span className="rounded-sm bg-[var(--c-text-subtle)] px-1 text-[10px] font-bold text-[var(--c-bg)]" aria-label="Explicit">E</span>}
        {track.durationSec !== undefined && <span className="text-xs tabular-nums text-[var(--c-text-muted)]">{fmtTime(track.durationSec)}</span>}
      </div>
      <ItemMenu item={track} queueIndex={i} className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
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
  // Drag to reorder (the shared pointer mechanism; Alt+↑ / Alt+↓ on a handle too).
  const { ref, dropAt, dragFrom, onHandleDown, onHandleKey } = useDragReorder<HTMLOListElement>((from, to) => usePlayer.getState().moveTrack(from, to));
  const firstScroll = useRef(true);
  const count = useRef(0);
  count.current = queue.length;
  const onRowKey = useCallback((i: number, e: ReactKeyboardEvent<HTMLElement>) => onHandleKey(i, count.current, e), [onHandleKey]);
  const currentId = queue[index]?.id;

  const indexRef = useRef(index);
  indexRef.current = index;
  const onRowClick = useCallback((e: ReactMouseEvent) => {
    const i = rowPlayClick(e);
    if (i < 0) return;
    const p = usePlayer.getState();
    if (i === indexRef.current) p.togglePlay();
    else p.playIndex(i);
  }, []);
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

  if (!queue.length) return <p className="px-2 text-sm text-[var(--c-text-subtle)]">Queue is empty. Play something to fill it.</p>;
  const firstAutoplay = queue.findIndex((t) => t.source === "autoplay");
  return (
    <ol ref={ref} onClick={onRowClick} className={`${dragFrom >= 0 ? "select-none" : ""} ${loading ? "pointer-events-none opacity-40" : ""}`} aria-busy={loading}>
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
            onHandleKey={onRowKey}
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
