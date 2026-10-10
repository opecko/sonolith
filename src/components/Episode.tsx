import { AudioLines, Play } from "lucide-react";
import { memo } from "react";
import type { EpisodeInfo, Track } from "../api/types";
import { usePlayer } from "../stores/player";
import ItemMenu from "./ItemMenu";
import Thumb from "./Thumb";

/** "2.4K views • 9h ago • 3 min left" (+ progress bar), as on YouTube Music. */
function Meta({ ep }: { ep?: EpisodeInfo }) {
  const p = ep?.progress;
  const parts = [ep?.meta, p?.text ?? ep?.durationText].filter(Boolean);
  return (
    <span className="flex items-center gap-2 text-xs text-[var(--c-text-muted)]">
      <span className="truncate">{parts.join(" • ")}</span>
      {p && p.percent > 0 && !p.played && (
        <span className="h-0.5 w-10 shrink-0 overflow-hidden rounded-full bg-[var(--c-slider-track)]" aria-label={`${p.percent}% played`}>
          <span className="block h-full origin-left bg-[var(--c-accent)]" style={{ transform: `scaleX(${p.percent / 100})` }} />
        </span>
      )}
    </span>
  );
}

function Art({ track, current, size }: { track: Track; current: boolean; size: string }) {
  return (
    <span className="relative shrink-0">
      <Thumb src={track.thumbnail} className={size} />
      <span className={`absolute inset-0 flex items-center justify-center rounded-[var(--radius)] bg-scrim/50 ${current ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        {current ? <AudioLines size={20} aria-hidden /> : <Play size={20} fill="currentColor" aria-hidden />}
      </span>
    </span>
  );
}

/** Show page row: art, title, two-line description, meta + progress, menu. */
export const EpisodeRow = memo(function EpisodeRow({ track, onPlay }: { track: Track; onPlay: () => void }) {
  const current = usePlayer((s) => s.queue[s.index]?.id === track.id);
  return (
    <li className="group flex gap-4 border-b border-[var(--c-outline)] py-4 last:border-0">
      <button onClick={onPlay} className="flex min-w-0 flex-1 gap-4 text-left" aria-label={`Play ${track.title}`}>
        <Art track={track} current={current} size="h-12 w-12" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${current ? "text-[var(--c-accent)]" : ""}`}>{track.title}</span>
          {track.episode?.description && (
            <span className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-[var(--c-text-muted)]">{track.episode.description}</span>
          )}
          <span className="mt-2 block"><Meta ep={track.episode} /></span>
        </span>
      </button>
      <ItemMenu item={track} className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
    </li>
  );
});

/** Channel page card (grid of "Latest episodes"): art left, meta + title right. */
export const EpisodeCard = memo(function EpisodeCard({ track, onPlay }: { track: Track; onPlay: () => void }) {
  const current = usePlayer((s) => s.queue[s.index]?.id === track.id);
  return (
    <div className="group flex w-[420px] shrink-0 items-center gap-4 rounded-[var(--radius)] pr-2 hover:bg-[var(--c-hover)]">
      <button onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-4 text-left" aria-label={`Play ${track.title}`}>
        <Art track={track} current={current} size="h-[72px] w-[124px]" />
        <span className="min-w-0 flex-1">
          <Meta ep={track.episode} />
          <span className={`mt-1 line-clamp-2 text-sm font-medium ${current ? "text-[var(--c-accent)]" : ""}`}>{track.title}</span>
        </span>
      </button>
      <ItemMenu item={track} className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
    </div>
  );
});
