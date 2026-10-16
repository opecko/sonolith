import { Play } from "lucide-react";
import { memo } from "react";
import type { Item } from "../api/types";
import { activateItem, playItem, prefetchItem } from "../stores/actions";
import ItemMenu from "./ItemMenu";
import Thumb from "./Thumb";
import { Byline } from "./TrackByline";

export const CARD_W = 180;
const width = (item: Item) => (item.art === "wide" ? Math.round((CARD_W * 16) / 9) : CARD_W);

function CardImpl({ item, fluid = false }: { item: Item; fluid?: boolean }) {
  const round = item.art === "round";
  const canPlay = item.type !== "artist";
  return (
    <div className={`group shrink-0 snap-start ${fluid ? "w-full" : ""}`} style={fluid ? undefined : { width: width(item) }}
      onPointerEnter={() => prefetchItem(item)} onPointerLeave={() => prefetchItem(null)}>
      <div className="relative">
        <button onClick={() => activateItem(item)} className="block w-full" aria-label={`Open ${item.title}`}>
          <span className="relative block">
            <Thumb src={item.thumbnail} round={round} className={`${item.art === "wide" ? "aspect-video" : "aspect-square"} m3-art-lg w-full`} />
            <span className={`absolute inset-0 bg-scrim/30 opacity-0 group-hover:opacity-100 ${round ? "rounded-full" : "m3-art m3-art-lg rounded-[var(--radius)]"}`} />
          </span>
        </button>
        {canPlay && (
          <button
            onClick={() => void playItem(item)}
            aria-label={`Play ${item.title}`}
            data-morph=""
            className={`m3-card-play absolute flex h-10 w-10 items-center justify-center rounded-full bg-scrim/70 text-on-scrim opacity-0 hover:scale-110 hover:bg-scrim/90 focus-visible:opacity-100 group-hover:opacity-100 ${
              item.type === "track" ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" : "bottom-2 right-2"
            }`}
          >
            <Play size={20} fill="currentColor" />
          </button>
        )}
      </div>
      {/* The title button covers the text (row-hit), so the subtitle opens the item too; a track's artist and album
          names are links above it. */}
      <div className="relative mt-2 flex items-start gap-1">
        <div className={`min-w-0 flex-1 text-left ${round ? "text-center" : ""}`}>
          <button onClick={() => activateItem(item)} className="row-hit block w-full [text-align:inherit]" title={item.title}>
            <span className="line-clamp-2 text-sm font-medium leading-5 [.row-hit:hover_&]:underline">{item.title}</span>
          </button>
          <span className="mt-0.5 line-clamp-2 text-sm leading-5 text-[var(--c-text-muted)]" title={item.subtitle}>
            {item.type === "track" ? <Byline track={item} /> : item.subtitle}
          </span>
        </div>
        <ItemMenu item={item} className="relative -mr-2 opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
      </div>
    </div>
  );
}

export default memo(CardImpl);
