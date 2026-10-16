import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Item, Shelf, Track } from "../api/types";
import { activateItem, playItem } from "../stores/actions";
import { useNav } from "../stores/nav";
import Card from "./Card";
import { EpisodeCard } from "./Episode";
import ItemMenu from "./ItemMenu";
import Thumb from "./Thumb";
import { Byline } from "./TrackByline";

function useScroller() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 4;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.9, behavior: "smooth" });
  return { ref, edges, update, page };
}

function QuickPickRow({ track }: { track: Track & Item }) {
  return (
    <div className="group relative flex w-[360px] items-center gap-3 rounded-[var(--radius)] pr-1 hover:bg-[var(--c-hover)]">
      <button onClick={() => void playItem(track)} className="relative z-[1] shrink-0" aria-label={`Play ${track.title}`}>
        <Thumb src={track.thumbnail} px={48} className="h-12 w-12" />
        <span className="absolute inset-0 flex items-center justify-center rounded-[var(--radius)] bg-scrim/50 opacity-0 group-hover:opacity-100">
          <Play size={20} fill="currentColor" />
        </span>
      </button>
      {/* The title button covers the row (row-hit); the play thumbnail, links and ⋮ sit above it. */}
      <span className="min-w-0 flex-1">
        <button onClick={() => activateItem(track)} className="row-hit block max-w-full truncate text-left text-sm font-medium">{track.title}</button>
        <span className="block truncate text-sm text-[var(--c-text-muted)]"><Byline track={track} /></span>
      </span>
      <ItemMenu item={track} className="relative opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
    </div>
  );
}

/** Podcast episodes (with episode details) get the 3-row episode card grid, like YouTube Music channel pages. */
const isEpisodeShelf = (shelf: Shelf) => shelf.items.length > 0 && shelf.items.every((i) => i.type === "track" && (i as Track).episode);

export function ShelfRow({ shelf }: { shelf: Shelf }) {
  const { ref, edges, update, page } = useScroller();
  const go = useNav((s) => s.go);
  const arrows = !(edges.start && edges.end);
  return (
    <section className="mb-12">
      {(shelf.title || arrows) && (
        <header className="mb-4 flex items-end gap-4">
          <div className="min-w-0 flex-1">
            {shelf.strapline && <p className="mb-1 text-xs uppercase tracking-wider text-[var(--c-text-muted)]">{shelf.strapline}</p>}
            {shelf.title && <h2 className="truncate text-2xl font-bold tracking-tight">{shelf.title}</h2>}
          </div>
          {shelf.more && (
            <button onClick={() => {
              const { browseId, params } = shelf.more!;
              go(browseId.startsWith("VL") ? { name: "playlist", id: browseId.slice(2) } : { name: "browse", id: browseId, params, title: shelf.title });
            }}
              className="m3-btn m3-outlined h-8 rounded-full border border-[var(--c-outline)] px-4 text-sm font-medium hover:bg-[var(--c-hover)]">
              More
            </button>
          )}
          {arrows && (
            <div className="flex gap-2">
              <button className="icon-btn h-8 w-8 border border-[var(--c-outline)]" disabled={edges.start} onClick={() => page(-1)} aria-label="Scroll left"><ChevronLeft size={20} /></button>
              <button className="icon-btn h-8 w-8 border border-[var(--c-outline)]" disabled={edges.end} onClick={() => page(1)} aria-label="Scroll right"><ChevronRight size={20} /></button>
            </div>
          )}
        </header>
      )}
      <div ref={ref} onScroll={update} className="no-scrollbar flex snap-x gap-6 overflow-x-auto scroll-smooth">
        {isEpisodeShelf(shelf) ? (
          <div className="grid auto-cols-max grid-flow-col grid-rows-3 gap-x-6 gap-y-4">
            {shelf.items.map((item, i) => (
              <EpisodeCard key={`${item.id}:${i}`} track={item as Track} onPlay={() => activateItem(item)} />
            ))}
          </div>
        ) : shelf.compact ? (
          <div className="grid auto-cols-max grid-flow-col grid-rows-4 gap-x-6 gap-y-2">
            {shelf.items.map((item, i) =>
              item.type === "track" ? <QuickPickRow key={`${item.id}:${i}`} track={item} /> : <Card key={`${item.id}:${i}`} item={item} />,
            )}
          </div>
        ) : (
          shelf.items.map((item, i) => <Card key={`${item.type}:${item.id}:${i}`} item={item} />)
        )}
      </div>
    </section>
  );
}

export function Shelves({ shelves }: { shelves: Shelf[] }) {
  return <>{shelves.map((s, i) => (s.layout === "grid" ? (
    <section key={`${s.title}:${i}`} className="mb-12">
      {s.title && <h2 className="mb-4 text-2xl font-bold tracking-tight">{s.title}</h2>}
      <ItemGrid items={s.items} />
    </section>
  ) : <ShelfRow key={`${s.title}:${i}`} shelf={s} />))}</>;
}

export function ItemGrid({ items }: { items: Item[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-6 gap-y-8">
      {items.map((item, i) => <Card key={`${item.type}:${item.id}:${i}`} item={item} fluid />)}
    </div>
  );
}
