// Up next → ⋮: save the queue as a playlist, and go back to one of the last queues (playback/recentQueues.ts).
import { AuthError } from "../api/client";
import { addToPlaylist } from "../api/ytm";
import { playlistTitle, pushRecent, readRecent, recentFrom, RECENT_KEY, replaced, type RecentQueue } from "../playback/recentQueues";
import { create } from "zustand";
import { useLibrary } from "./library";
import { usePlayer } from "./player";
import { useToast } from "./toast";

const load = () => {
  try {
    return readRecent(localStorage.getItem(RECENT_KEY));
  } catch {
    return [];
  }
};

export const useRecentQueues = create<{ list: RecentQueue[] }>(() => ({ list: load() }));

let started = false;
/** Keeps the queue a new one replaces (registered once). */
export function initRecentQueues() {
  if (started) return;
  started = true;
  usePlayer.subscribe((s, prev) => {
    if (s.queue === prev.queue || !replaced(prev.queue, prev.index, s.queue)) return;
    const entry = recentFrom(prev.queue, prev.index, prev.context, Date.now());
    if (!entry) return;
    const list = pushRecent(useRecentQueues.getState().list, entry);
    useRecentQueues.setState({ list });
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
    } catch {
      /* storage unavailable: kept until restart */
    }
  });
}

/** Plays a recent queue again from the song that was playing (it then counts as the current queue). */
export function restoreQueue(q: RecentQueue) {
  usePlayer.getState().playQueue(q.tracks, q.index, q.context);
}

/** YouTube takes this many songs per request. */
const CHUNK = 100;

/** A private playlist with the whole queue, in play order. */
export async function saveQueueAsPlaylist() {
  const { queue, context } = usePlayer.getState();
  const ids = [...new Set(queue.map((t) => t.id))];
  if (!ids.length) return;
  const title = playlistTitle(context, new Date());
  const toast = useToast.getState().show;
  try {
    const id = await useLibrary.getState().create(title, { privacy: "private", videoIds: ids.slice(0, CHUNK) });
    if (!id) throw new Error("YouTube didn't create it");
    for (let i = CHUNK; i < ids.length; i += CHUNK) await addToPlaylist(id, ids.slice(i, i + CHUNK));
    toast(`Saved the queue as "${title}" (private)`, "info");
  } catch (e) {
    toast(e instanceof AuthError ? "Sign in to save the queue as a playlist" : `Could not save the queue: ${e instanceof Error ? e.message : e}`);
  }
}
