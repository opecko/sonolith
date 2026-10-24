import type { Track } from "../api/types";

/**
 * Moves queue[from] to position `to`. Returns the new queue and the index that keeps pointing at the playing track.
 * An autoplay track dropped right after a real one becomes part of the real queue (it's above the divider). Real
 * tracks never turn into autoplay ones, so turning autoplay off can't delete something the user queued.
 */
export function reorder(queue: Track[], index: number, from: number, to: number): { queue: Track[]; index: number } | null {
  if (from === to || !queue[from] || to < 0 || to >= queue.length) return null;
  const next = [...queue];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  if (moved.source === "autoplay" && next[to - 1]?.source !== "autoplay") next[to] = { ...moved, source: undefined };
  const newIndex =
    from === index ? to : from < index && to >= index ? index - 1 : from > index && to <= index ? index + 1 : index;
  return { queue: next, index: newIndex };
}

/** Each track once (an album or playlist can list a song twice), in order. */
export function dedupe(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((t) => !seen.has(t.id) && seen.add(t.id));
}

/**
 * Play next: `tracks` right after the playing one. Ones already later in the queue move up; the playing track
 * stays where it is. Returns the new queue and what was actually added.
 */
export function insertNext(queue: Track[], index: number, tracks: Track[]): { queue: Track[]; added: Track[] } {
  const added = dedupe(tracks).filter((t) => t.id !== queue[index]?.id);
  const ids = new Set(added.map((t) => t.id));
  const rest = queue.slice(index + 1).filter((t) => !ids.has(t.id));
  return { queue: [...queue.slice(0, index + 1), ...added, ...rest], added };
}

/**
 * Add to queue: `tracks` at the end of what the user queued, skipping ones still to come (or playing). Upcoming
 * autoplay tracks stay after them, below the divider.
 */
export function append(queue: Track[], index: number, tracks: Track[]): { queue: Track[]; added: Track[] } {
  const upcoming = new Set(queue.slice(index).map((t) => t.id));
  const added = dedupe(tracks).filter((t) => !upcoming.has(t.id));
  if (!added.length) return { queue, added };
  let at = queue.length;
  while (at > index + 1 && queue[at - 1].source === "autoplay") at--;
  return { queue: [...queue.slice(0, at), ...added, ...queue.slice(at)], added };
}
