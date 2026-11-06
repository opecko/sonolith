// What the recap playlist buttons do: play, add to the queue (both work signed out) and save to the library (signed
// in; a private playlist, never made automatically). A saved playlist is remembered per recap and kind, so the
// button becomes "Open playlist" while it still exists.
import { addToPlaylist, getPlaylist, preferSongs } from "../api/ytm";
import { useAuth } from "../stores/auth";
import { useLibrary } from "../stores/library";
import { useNav } from "../stores/nav";
import { usePlayer } from "../stores/player";
import { useToast } from "../stores/toast";
import { asTrack, PLAYLIST_LABEL, playlistGone, playlistDescription, playlistTitle, selectTracks, type PlaylistKind } from "./playlists";
import type { Snapshot } from "./snapshot";
import { rememberPlaylist, savedPlaylist } from "./store";
import { closeRecapPlayer } from "./ui";

const tracksOf = (snap: Snapshot, kind: PlaylistKind) => selectTracks(kind, snap.stats, snap.period).map(asTrack);
const toast = (msg: string, kind?: "info") => useToast.getState().show(msg, kind);

export function playRecapPlaylist(snap: Snapshot, kind: PlaylistKind) {
  const tracks = tracksOf(snap, kind);
  if (!tracks.length) return;
  usePlayer.getState().playQueue(tracks, 0, { title: playlistTitle(kind, snap.period) });
}

export function queueRecapPlaylist(snap: Snapshot, kind: PlaylistKind) {
  const tracks = tracksOf(snap, kind);
  if (!tracks.length) return;
  usePlayer.getState().addToQueue(tracks);
  toast(`Added ${tracks.length} songs to the queue`, "info");
}

/**
 * The saved playlist's id if it still exists. Only a playlist YouTube reports as gone is forgotten: offline, another
 * account or any other error keeps it (forgetting would offer Save again and make a duplicate).
 */
export async function existingPlaylist(snap: Snapshot, kind: PlaylistKind): Promise<string | null> {
  const id = savedPlaylist(snap.id, kind);
  if (!id) return null;
  try {
    await getPlaylist(id);
    return id;
  } catch (e) {
    if (!playlistGone(e)) return id;
    await rememberPlaylist(snap.id, kind, null);
    return null;
  }
}

export function openSavedPlaylist(id: string) {
  closeRecapPlayer();
  useNav.getState().go({ name: "playlist", id });
}

/**
 * Saves the playlist as a private one in the library. Songs are preferred over music videos; if creating it with
 * all songs fails, it's created empty and filled in chunks, and the toast says how many couldn't be added.
 */
export async function saveRecapPlaylist(snap: Snapshot, kind: PlaylistKind): Promise<string | null> {
  if (useAuth.getState().status !== "signedIn") {
    toast("Sign in to save playlists to your library");
    return null;
  }
  let tracks = tracksOf(snap, kind);
  if (!tracks.length) return null;
  tracks = await preferSongs(tracks).catch(() => tracks);
  const ids = [...new Set(tracks.map((t) => t.id))];
  const title = playlistTitle(kind, snap.period);
  const create = useLibrary.getState().create;
  const opts = { description: playlistDescription(snap.period), privacy: "private" as const };
  let id: string | undefined;
  let failed = 0;
  try {
    id = await create(title, { ...opts, videoIds: ids });
  } catch {
    try {
      id = await create(title, opts);
    } catch (e) {
      toast(`Could not save "${title}": ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    if (id)
      for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        await addToPlaylist(id, chunk).catch(() => (failed += chunk.length));
      }
  }
  if (!id) {
    toast(`Could not save "${title}"`);
    return null;
  }
  await rememberPlaylist(snap.id, kind, id);
  toast(failed ? `Saved "${PLAYLIST_LABEL[kind]}", but ${failed} songs couldn't be added` : `Saved "${title}" to your library`, failed ? undefined : "info");
  return id;
}
