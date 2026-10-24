// Pure pieces of the published state: player status, queue change reasons, queue entry ids.
import type { QueueChangeReason, PlaybackStatus } from "./schema.gen";

/** The player store's status as the API names it. */
export function playbackStatus(status: "idle" | "loading" | "playing" | "paused" | "error", hasItem: boolean, buffering: boolean): PlaybackStatus {
  if (!hasItem || status === "error") return "stopped";
  if (status === "loading" || (status === "playing" && buffering)) return "buffering";
  return status === "playing" ? "playing" : "paused";
}

export interface QueueShape {
  ids: string[];
  index: number;
  /** Which entries came from autoplay, by position. */
  autoplay: boolean[];
}

/**
 * Why the queue changed, for `queue.changed`; null when entries and position are the same (the revision stays).
 * Checked in order: same entries (advanced), appended, emptied, removed, reordered, otherwise replaced.
 */
export function queueChangeReason(prev: QueueShape, next: QueueShape): QueueChangeReason | null {
  const same = prev.ids.length === next.ids.length && prev.ids.every((id, i) => id === next.ids[i]);
  if (same) return prev.index === next.index ? null : "advanced";
  const before = new Set(prev.ids);
  const after = new Set(next.ids);
  const added = next.ids.map((id, i) => (before.has(id) ? -1 : i)).filter((i) => i >= 0);
  const removed = prev.ids.map((id, i) => (after.has(id) ? -1 : i)).filter((i) => i >= 0);
  const current = prev.ids[prev.index];
  if (!removed.length && added.length) return added.every((i) => next.autoplay[i]) ? "autoplay" : "added";
  if (!added.length && removed.length) {
    if (next.ids.length <= 1 && (next.ids.length === 0 || next.ids[0] === current) && prev.ids.length > 1) return "cleared";
    return removed.every((i) => prev.autoplay[i]) ? "autoplay" : "removed";
  }
  if (!added.length && !removed.length) return "moved";
  return "replaced";
}

/** Entry ids: the item id, with the occurrence number for an item queued more than once. */
export function entryIds(ids: string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n ? `${id}~${n}` : id;
  });
}
