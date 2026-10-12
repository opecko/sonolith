import { useState } from "react";
import type { Playlist, Track } from "../api/types";
import { getPlaylist } from "../api/ytm";
import LoadMore from "../components/LoadMore";
import PageHeader from "../components/PageHeader";
import { EmptyState, ErrorBox, Loading } from "../components/Status";
import TrackList from "../components/TrackList";
import { useAsync } from "../hooks/useData";
import { useLibrary } from "../stores/library";

interface Extra {
  id: string;
  base: Playlist;
  tracks: Track[];
  next: Playlist["loadMore"];
}

export default function PlaylistView({ id }: { id: string }) {
  const head = useAsync<Playlist>(`playlist:${id}`, () => getPlaylist(id));
  // A just-created playlist comes back from YouTube without its title for a while; the sidebar already knows it.
  const listed = useLibrary((s) => s.playlists?.find((x) => x.id === id));
  const [extra, setExtra] = useState<Extra | null>(null);
  const [more, setMore] = useState<{ loading: boolean; error?: Error }>({ loading: false });

  if (head.error) return <ErrorBox error={head.error} onRetry={head.reload} />;
  if (!head.data) return <Loading variant="list" />;
  const p = head.data;
  // Tied to the first page it continues: a refetch (song added/removed) starts the paging over.
  const state: Extra = extra?.id === id && extra.base === p ? extra : { id, base: p, tracks: [], next: p.loadMore };
  const tracks = [...p.tracks, ...state.tracks];

  const loadMore = async () => {
    if (!state.next || more.loading) return;
    setMore({ loading: true });
    try {
      const page = await state.next();
      setExtra({ id, base: p, tracks: [...state.tracks, ...page.tracks], next: page.loadMore });
      setMore({ loading: false });
    } catch (e) {
      setMore({ loading: false, error: e instanceof Error ? e : new Error(String(e)) });
    }
  };

  const title = p.title || listed?.title || "Playlist";
  const empty = !tracks.length && !state.next;
  return (
    <>
      <PageHeader title={title} subtitle={p.subtitle || listed?.subtitle || ""} thumbnail={p.thumbnail ?? listed?.thumbnail} tracks={tracks} playlistId={id}
        radio={empty ? undefined : { type: id.startsWith("RD") ? "mix" : "playlist", id }} />
      {empty ? (
        <EmptyState title="This playlist is empty" detail={'Add songs with "Save to playlist" in any song\'s ⋮ menu.'} />
      ) : (
        <TrackList tracks={tracks} context={{ playlistId: id, title }} />
      )}
      {more.error && <ErrorBox error={more.error} onRetry={loadMore} />}
      <LoadMore active={!!state.next && !more.error} loading={more.loading} onVisible={loadMore} />
    </>
  );
}
