import { AudioLines, Play } from "lucide-react";
import { memo, useCallback } from "react";
import type { Track } from "../api/types";
import { useNav } from "../stores/nav";
import { usePlayer, type QueueContext } from "../stores/player";
import ItemMenu from "./ItemMenu";
import { fmtTime } from "./PlayerBar";
import RatingButtons from "./RatingButtons";
import Thumb from "./Thumb";

const Explicit = () => <span className="shrink-0 rounded-sm bg-[var(--c-text-subtle)] px-1 text-[10px] font-bold text-[var(--c-bg)]" aria-label="Explicit">E</span>;

interface RowProps {
  track: Track;
  index: number;
  current: boolean;
  /** "list": number + two-line title; "table": title | artist | album columns (history). */
  variant: "list" | "table";
  compact: boolean;
  onPlay: (index: number) => void;
  /** Set on a playlist's page: the menu offers "Remove from playlist" there. */
  playlistId?: string;
}

const Row = memo(function Row({ track: t, index, current, variant, compact, onPlay, playlistId }: RowProps) {
  const albumId = t.album?.id;
  return (
    <li data-current={current ? "" : undefined} className="m3-row group flex items-center gap-2 rounded-[var(--radius)] border-b border-[var(--c-outline)] pr-2 last:border-0 hover:bg-[var(--c-hover)]">
      <button onClick={() => onPlay(index)} aria-current={current ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-4 px-2 py-2 text-left">
        {variant === "list" && !compact && <span className="w-6 text-right text-sm tabular-nums text-[var(--c-text-subtle)]">{index + 1}</span>}
        <span className="relative shrink-0">
          <Thumb src={t.thumbnail} px={40} className="h-10 w-10" />
          <span className={`m3-art absolute inset-0 flex items-center justify-center rounded-[var(--radius)] bg-scrim/60 ${current ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            {current ? <AudioLines size={18} aria-hidden /> : <Play size={18} fill="currentColor" aria-hidden />}
          </span>
        </span>
        {variant === "list" ? (
          <>
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm font-medium ${current ? "text-[var(--c-accent)]" : ""}`}>{t.title}</span>
              <span className="block truncate text-sm text-[var(--c-text-muted)]">{t.subtitle}</span>
            </span>
            {t.explicit && <Explicit />}
          </>
        ) : (
          <>
            <span className="flex min-w-0 flex-[3] items-center gap-2">
              <span className={`truncate text-sm font-medium ${current ? "text-[var(--c-accent)]" : ""}`}>{t.title}</span>
              {t.explicit && <Explicit />}
            </span>
            <span className="min-w-0 flex-[2] truncate text-sm text-[var(--c-text-muted)]">{t.artists.join(", ") || t.subtitle}</span>
          </>
        )}
      </button>
      {variant === "table" && (
        <span className="hidden min-w-0 flex-[2] truncate text-sm text-[var(--c-text-muted)] lg:block">
          {albumId ? (
            <button className="max-w-full truncate hover:underline" onClick={() => useNav.getState().go({ name: "album", id: albumId })}>{t.album!.title}</button>
          ) : t.album?.title}
        </span>
      )}
      <RatingButtons track={t} size={18} className="opacity-0 focus-within:opacity-100 group-hover:opacity-100" />
      <ItemMenu item={t} playlistId={playlistId} className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
      <span className="w-12 shrink-0 text-right text-sm tabular-nums text-[var(--c-text-muted)]">{t.durationSec !== undefined ? fmtTime(t.durationSec) : ""}</span>
    </li>
  );
});

export default function TrackList({ tracks, radio = false, compact = false, context, variant = "list" }: {
  tracks: Track[]; radio?: boolean; compact?: boolean; context?: QueueContext; variant?: "list" | "table";
}) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const onPlay = useCallback(
    (i: number) => {
      const p = usePlayer.getState();
      if (radio) p.playRadio(tracks[i]);
      else p.playQueue(tracks, i, context);
    },
    [tracks, radio, context],
  );
  return (
    <ol>
      {tracks.map((t, i) => (
        <Row key={`${t.id}:${i}`} track={t} index={i} current={t.id === currentId} variant={variant} compact={compact} onPlay={onPlay} playlistId={context?.playlistId} />
      ))}
    </ol>
  );
}
