import type { Item, Track } from "../api/types";
import { getAlbum, getArtist, getPlaylist } from "../api/ytm";
import { prefetch } from "../hooks/useData";
import { openItem } from "./nav";
import { usePlayer } from "./player";
import { useToast } from "./toast";

/** Card/row click: tracks start a radio, everything else navigates. */
export function activateItem(item: Item) {
  // Episodes play on their own (no song radio); everything else track-like starts a radio.
  if (item.type === "track" && item.podcast) usePlayer.getState().playQueue([item], 0, { title: item.title });
  else if (item.type === "track") usePlayer.getState().playRadio(item);
  else openItem(item);
}

/** Play overlay: plays an album/playlist from the top without navigating. */
export async function playItem(item: Item) {
  try {
    if (item.type === "track") return usePlayer.getState().playRadio(item);
    if (item.type === "album") return usePlayer.getState().playQueue((await getAlbum(item.id)).tracks, 0, { title: item.title });
    if (item.type === "playlist")
      return usePlayer.getState().playQueue((await getPlaylist(item.id)).tracks, 0, { playlistId: item.id, title: item.title });
    openItem(item);
  } catch (e) {
    useToast.getState().show(`Could not play "${item.title}": ${e instanceof Error ? e.message : e}`);
  }
}

/** Pages fetched at most for a playlist action (a page is ~100 songs; Liked Music can have thousands). */
const MAX_PAGES = 10;

/** Every track of an album or playlist (following a playlist's pages), for Play next / Add to queue / Shuffle. */
export async function collectionTracks(item: Item): Promise<Track[]> {
  if (item.type === "album") return (await getAlbum(item.id)).tracks;
  if (item.type !== "playlist") return [];
  let page = await getPlaylist(item.id);
  const all = [...page.tracks];
  for (let i = 0; page.loadMore && i < MAX_PAGES; i++) {
    page = await page.loadMore();
    all.push(...page.tracks);
  }
  return all;
}

const songs = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;

/** Menu actions on a whole album or playlist; errors and results end up in a toast. */
export async function queueCollection(item: Item, how: "next" | "end" | "shuffle") {
  try {
    const tracks = await collectionTracks(item);
    if (!tracks.length) return useToast.getState().show(`"${item.title}" has no songs to play`, "info");
    const p = usePlayer.getState();
    const context = item.type === "playlist" ? { playlistId: item.id, title: item.title } : { title: item.title };
    if (how === "shuffle") {
      if (!p.shuffle) p.toggleShuffle();
      return p.playQueue(tracks, Math.floor(Math.random() * tracks.length), context);
    }
    if (how === "next") p.playNext(tracks);
    else p.addToQueue(tracks);
    useToast.getState().show(how === "next" ? `${songs(tracks.length)} will play next` : `Added ${songs(tracks.length)} to the queue`, "info");
  } catch (e) {
    useToast.getState().show(`Could not load "${item.title}": ${e instanceof Error ? e.message : e}`);
  }
}

let hoverTimer: ReturnType<typeof setTimeout> | undefined;

/** Hover intent: after a short pause, start loading the page the item opens so the click feels instant. */
export function prefetchItem(item: Item | null) {
  clearTimeout(hoverTimer);
  if (!item || item.type === "track") return;
  hoverTimer = setTimeout(() => {
    if (item.type === "album") prefetch(`album:${item.id}`, () => getAlbum(item.id));
    else if (item.type === "playlist") prefetch(`playlist:${item.id}`, () => getPlaylist(item.id));
    else if (item.type === "artist") prefetch(`artist:${item.id}`, () => getArtist(item.id));
  }, 120);
}
