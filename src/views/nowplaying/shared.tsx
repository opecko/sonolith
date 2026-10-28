import type { BrowseRef } from "../../api/types";
import { getRelated } from "../../api/ytm";
import AutoplayToggle from "../../components/AutoplayToggle";
import { QueueChips } from "../../components/QueueChips";
import QueueList from "../../components/QueueList";
import { Shelves } from "../../components/Shelves";
import { EmptyState, ErrorBox, Loading } from "../../components/Status";
import { useAsync } from "../../hooks/useData";
import LyricsView from "../../lyrics/LyricsView";
import { lyricsShown } from "../../lyrics/pick";
import { useLyrics } from "../../lyrics/store";
import { useSettings } from "../../stores/settings";
import { usePlayer } from "../../stores/player";

/** Now Playing panels shared by every layout: the queue, lyrics and related music of the current track. */
export type Tab = "upnext" | "related" | "lyrics";

/**
 * The current track's related-music target, once /next has it (undefined = none or not yet), whether Now Playing
 * offers Related (`hasRelated`) and whether it has lyrics (from any enabled provider or YouTube Music's own,
 * lyrics/store.ts). While either is still loading, it counts as there when the track before had it, so skipping
 * doesn't take the tab away and bring it back a moment later.
 */
export function useTrackExtras() {
  const videoId = usePlayer((s) => s.queue[s.index]?.id);
  const related = usePlayer((s) => (s.watch?.videoId === videoId ? s.watch?.related : undefined));
  const relatedHeld = usePlayer((s) => s.relatedHeld);
  const on = useSettings((s) => s.lyricsEnabled);
  const lyrics = useLyrics((s) => lyricsShown(s, videoId)) && on;
  return { videoId, related, hasRelated: !!related || relatedHeld, lyrics };
}

/** Related for the panels: loading while /next is on its way (held), "Nothing related" while a panel closes. */
export function RelatedPanel({ videoId, related, held }: { videoId: string; related: BrowseRef | undefined; held: boolean }) {
  if (related) return <RelatedTab key={videoId} videoId={videoId} target={related} />;
  return held ? <Loading variant="list" label="Loading related" /> : <EmptyState title="Nothing related" />;
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

/** The lyrics tab / panel: synced when a provider has them. */
export const LyricsTab = LyricsView;

