import { create } from "zustand";
import type { Page, Track } from "../api/types";
import { getPlaylistEntries } from "../api/ytm";

/**
 * Which songs one playlist holds: the Save button's chosen playlist ("One playlist"), so the button shows a song
 * that's already in it as pressed. Loaded once per playlist (all pages), then kept up to date by the app's own
 * saves and removals (`noteSaved` / `noteRemoved`, called from ItemMenu's actions); edits made elsewhere show after
 * the next load (a restart or another playlist chosen).
 */
interface MembersState {
  playlistId: string | null;
  ids: ReadonlySet<string> | null;
}

export const usePlaylistMembers = create<MembersState>(() => ({ playlistId: null, ids: null }));

/** Pages of a playlist read at most (100 songs each): enough for the playlists people save into by hand. */
const MAX_PAGES = 30;
let loading: string | null = null;

/** Loads the songs of `playlistId` unless they're loaded or loading; a failure leaves the button unpressed. */
export async function watchPlaylist(playlistId: string) {
  if (usePlaylistMembers.getState().playlistId === playlistId || loading === playlistId) return;
  loading = playlistId;
  usePlaylistMembers.setState({ playlistId, ids: null });
  try {
    let page: Page<Track> = await getPlaylistEntries(playlistId);
    const ids = new Set(page.items.map((t) => t.id));
    for (let i = 0; page.loadMore && i < MAX_PAGES; i++) {
      page = await page.loadMore();
      for (const t of page.items) ids.add(t.id);
    }
    if (usePlaylistMembers.getState().playlistId === playlistId) usePlaylistMembers.setState({ ids });
  } catch {
    // Unknown: shown as not saved, and tried again next time the button shows.
    if (usePlaylistMembers.getState().playlistId === playlistId) usePlaylistMembers.setState({ playlistId: null, ids: null });
  } finally {
    if (loading === playlistId) loading = null;
  }
}

function change(playlistId: string, videoId: string, add: boolean) {
  const { playlistId: watched, ids } = usePlaylistMembers.getState();
  if (watched !== playlistId || !ids) return;
  const next = new Set(ids);
  if (add) next.add(videoId);
  else next.delete(videoId);
  usePlaylistMembers.setState({ ids: next });
}

export const noteSaved = (playlistId: string, videoId: string) => change(playlistId, videoId, true);
export const noteRemoved = (playlistId: string, videoId: string) => change(playlistId, videoId, false);
