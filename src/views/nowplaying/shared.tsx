import type { BrowseRef } from "../../api/types";
import { getLyrics, getRelated } from "../../api/ytm";
import AutoplayToggle from "../../components/AutoplayToggle";
import { QueueChips } from "../../components/QueueChips";
import QueueList from "../../components/QueueList";
import { Shelves } from "../../components/Shelves";
import { EmptyState, ErrorBox, Loading } from "../../components/Status";
import { useAsync } from "../../hooks/useData";
import { usePlayer } from "../../stores/player";

/** Now Playing panels shared by every layout: the queue, lyrics and related music of the current track. */
export type Tab = "upnext" | "related" | "lyrics";

/** The lyrics / related browse targets of the current track, once /next has them (undefined = not available). */
export function useTrackExtras() {
  const videoId = usePlayer((s) => s.queue[s.index]?.id);
  const related = usePlayer((s) => (s.watch?.videoId === videoId ? s.watch?.related : undefined));
  const lyrics = usePlayer((s) => (s.watch?.videoId === videoId ? s.watch?.lyrics : undefined));
  return { videoId, related, lyrics };
}

export function UpNextTab() {
  const header = usePlayer((s) => s.watch?.header);
  const contextTitle = usePlayer((s) => s.context.title);
  const caption = "Playing from";
  // The queue's own name (playlist, album, mix, radio) wins; /next's per-track header is only a fallback.
  const title = contextTitle || header?.subtitle;
  return (
    <>
      <div className="mb-4 flex shrink-0 items-start justify-between gap-4 px-2">
        <div className="min-w-0">
          <p className="text-xs text-[var(--c-text-muted)]">{caption}</p>
          {title && <p className="truncate text-base font-semibold">{title}</p>}
        </div>
        <AutoplayToggle />
      </div>
      <div className="shrink-0"><QueueChips /></div>
      <div className="scroll-y min-h-0 flex-1 pr-1">
        <QueueList autoScroll />
      </div>
    </>
  );
}

export function RelatedTab({ videoId, target }: { videoId: string; target: BrowseRef }) {
  const { data, error, reload } = useAsync(`related:${videoId}`, () => getRelated(target));
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading variant="list" label="Loading related" />;
  if (!data.length) return <EmptyState title="Nothing related" />;
  return <Shelves shelves={data} />;
}

export function LyricsTab({ videoId, target }: { videoId: string; target: BrowseRef }) {
  const { data, error, reload } = useAsync(`lyrics:${videoId}`, () => getLyrics(target));
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (data === undefined) return <Loading variant="list" label="Loading lyrics" />;
  if (!data) return <EmptyState title="Lyrics aren't available" />;
  return (
    <div className="px-2">
      <p className="select-text whitespace-pre-wrap text-lg leading-8">{data.text}</p>
      {data.source && <p className="mt-6 text-xs text-[var(--c-text-subtle)]">{data.source}</p>}
    </div>
  );
}

