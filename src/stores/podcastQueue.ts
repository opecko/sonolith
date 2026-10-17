import type { Track } from "../api/types";

/**
 * The episode that follows `currentId` in a show listed newest first: the next newer one (a show is followed in
 * the order it was published). Null when it's the newest, or not in the list.
 */
export function nextEpisode(newestFirst: Track[], currentId: string): Track | null {
  const i = newestFirst.findIndex((t) => t.id === currentId);
  return i > 0 ? newestFirst[i - 1] : null;
}
