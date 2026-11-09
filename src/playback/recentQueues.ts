// Recent queues (Up next → ⋮ → Recent queues): the last few queues that a new one replaced, to go back to. Pure;
// stores/recentQueues.ts keeps them in localStorage.
import type { Track } from "../api/types";
import type { QueueContext } from "../stores/player";

export const RECENT_KEY = "recent-queues-v1";
/** How many queues are kept, newest first. */
export const RECENT_MAX = 5;
/** Songs kept per queue (around the one that was playing): enough to pick up again, small enough to store. */
const KEEP = 200;

export interface RecentQueue {
  title: string;
  savedAt: number;
  tracks: Track[];
  index: number;
  context: QueueContext;
}

/** A queue as worth keeping (two songs or more), trimmed around the current song and without per-session tokens. */
export function recentFrom(queue: Track[], index: number, context: QueueContext, now: number): RecentQueue | null {
  if (queue.length < 2 || index < 0 || index >= queue.length) return null;
  const from = Math.max(0, Math.min(index - 20, queue.length - KEEP));
  const tracks = queue.slice(from, from + KEEP).map(({ menu: _menu, ...t }) => t as Track);
  // The continuation was for a radio YouTube may no longer extend; the rest of the context stays.
  const { continuation: _c, autoplay: _a, ...ctx } = context;
  return { title: queueTitle(queue, context), savedAt: now, tracks, index: index - from, context: ctx };
}

/** The queue's own name, or "<first song> and N more". */
export function queueTitle(queue: Track[], context: QueueContext): string {
  if (context.title) return context.title;
  return queue.length > 1 ? `${queue[0].title} and ${queue.length - 1} more` : queue[0]?.title ?? "Queue";
}

/** Same queue: same name and the same first songs (playing it again from another song isn't a new one). */
const sameQueue = (a: RecentQueue, b: RecentQueue) =>
  a.title === b.title && a.tracks.slice(0, 5).map((t) => t.id).join() === b.tracks.slice(0, 5).map((t) => t.id).join();

/** `entry` first, an older copy of the same queue dropped, at most RECENT_MAX. */
export const pushRecent = (list: RecentQueue[], entry: RecentQueue) => [entry, ...list.filter((q) => !sameQueue(q, entry))].slice(0, RECENT_MAX);

/** Stored JSON → queues; anything malformed is left out. */
export function readRecent(raw: string | null): RecentQueue[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((q): q is RecentQueue =>
      !!q && typeof q.title === "string" && Number.isFinite(q.savedAt) && Array.isArray(q.tracks) && q.tracks.length > 0 &&
      q.tracks.every((t: Track) => t && t.type === "track" && typeof t.id === "string" && typeof t.title === "string" && Array.isArray(t.artists)) &&
      Number.isInteger(q.index) && q.index >= 0 && q.index < q.tracks.length && !!q.context && typeof q.context === "object",
    ).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** A queue the player replaced (not appended to or reordered): the song that was playing isn't in the new one. */
export function replaced(prev: Track[], prevIndex: number, next: Track[]): boolean {
  const cur = prev[prevIndex];
  return !!cur && prev !== next && !next.some((t) => t.id === cur.id);
}

/** A name for a playlist made from the queue: its own, or "Queue, 9 Nov 2026". */
export function playlistTitle(context: QueueContext, now: Date): string {
  return context.title || `Queue, ${now.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}
