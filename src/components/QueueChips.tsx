import { useEffect, useRef } from "react";
import { usePlayer } from "../stores/player";

/**
 * The mouse wheel scrolls a horizontal row sideways while it can; at either end it lets the page scroll as usual.
 * A native listener: React's wheel handlers are passive and can't stop the vertical scroll.
 */
function useWheelToHorizontal<T extends HTMLElement>(mounted: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
      const max = el.scrollWidth - el.clientWidth;
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      // Line-mode wheels report lines, not pixels.
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mounted]);
  return ref;
}

/**
 * Mix chips of a radio queue (All, Familiar, Discover, …), in every Now Playing layout. A row wider than its
 * space scrolls sideways: the app's thin scrollbar (shown while hovering), the mouse wheel, and keyboard focus
 * bringing a chip into view.
 */
export function QueueChips() {
  const chips = usePlayer((s) => s.chips);
  const active = usePlayer((s) => s.activeChipId);
  const loading = usePlayer((s) => s.chipLoading);
  const selectChip = usePlayer((s) => s.selectChip);
  const row = useWheelToHorizontal<HTMLDivElement>(chips.length > 0);
  if (!chips.length) return null;
  return (
    <div ref={row} role="toolbar" aria-label="Queue filters" className="scroll-x mb-2 flex gap-2 px-2">
      {chips.map((c) => (
        <button
          key={c.id}
          onClick={() => selectChip(c.id)}
          onFocus={(e) => e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
          aria-pressed={c.id === active}
          disabled={loading && c.id === active}
          className="chip"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
