import { useState } from "react";
import type { LibrarySection, Track } from "../api/types";
import { getLibrary } from "../api/ytm";
import { EpisodeRow } from "../components/Episode";
import LoadMore from "../components/LoadMore";
import { ItemGrid } from "../components/Shelves";
import { EmptyState, ErrorBox, Loading } from "../components/Status";
import TrackList from "../components/TrackList";
import { usePaged } from "../hooks/useData";
import { playEpisode } from "../stores/actions";

const tabs: { id: LibrarySection; label: string }[] = [
  { id: "playlists", label: "Playlists" },
  { id: "songs", label: "Songs" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "liked", label: "Liked songs" },
  { id: "podcasts", label: "Podcasts" },
  { id: "episodes", label: "Episodes for later" },
];

const EMPTY: Record<LibrarySection, string> = {
  playlists: "Playlists you create or save show up here.",
  albums: "Save albums to your library to see them here.",
  artists: "Subscribe to artists to see them here.",
  liked: "Songs you like show up here.",
  songs: "Songs you save to your library show up here.",
  podcasts: "Podcasts you save show up here.",
  episodes: "Episodes you save for later show up here.",
};

const QUEUE_CONTEXT = {
  liked: { playlistId: "LM", title: "Liked music" },
  songs: { title: "Library songs" },
} as const;

export default function LibraryView() {
  const [section, setSection] = useState<LibrarySection>("playlists");
  const { items, loading, error, hasMore, loadingMore, loadMore, reload } = usePaged(`library:${section}`, () => getLibrary(section));
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Library</h1>
      <div className="mb-8 flex gap-3" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={section === t.id}
            aria-pressed={section === t.id}
            onClick={() => setSection(t.id)}
            className="chip"
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && !items ? <ErrorBox error={error} onRetry={reload} /> : loading || !items ? <Loading variant={section === "liked" || section === "songs" || section === "episodes" ? "list" : "grid"} /> : (
        <>
          {items.length === 0 && <EmptyState title="Nothing here yet" detail={EMPTY[section]} />}
          {section === "liked" || section === "songs"
            ? <TrackList tracks={items as Track[]} context={QUEUE_CONTEXT[section]} />
            : section === "episodes"
              ? <ol>{(items as Track[]).map((t, i) => <EpisodeRow key={`${t.id}:${i}`} track={t} onPlay={() => playEpisode(t)} />)}</ol>
              : <ItemGrid items={items} />}
          <LoadMore active={hasMore && !error} loading={loadingMore} onVisible={loadMore} />
        </>
      )}
    </>
  );
}
