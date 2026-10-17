import type { LyricsProviderId } from "./providers";

/** One line of synced lyrics (ms); `words` when the provider times words / syllables. */
export interface LyricLine {
  start: number;
  end?: number;
  text: string;
  words?: { start: number; end: number; text: string }[];
}

export interface LyricsData {
  provider: LyricsProviderId;
  synced: boolean;
  lines: LyricLine[];
  plain?: string;
  /** Where the provider got them ("Musixmatch"), when it says. */
  source?: string;
}

/**
 * Picks between the providers' best answer and YouTube Music's own plain lyrics (the app's lyrics tab, which the
 * backend's YouTube source doesn't return): synced lyrics always win; between unsynced ones, the provider higher in
 * the user's order. Pure.
 */
export function chooseLyrics(fromProviders: LyricsData | null, youtubePlain: LyricsData | null, order: LyricsProviderId[]): LyricsData | null {
  if (fromProviders?.synced) return fromProviders;
  if (!fromProviders) return youtubePlain;
  if (!youtubePlain) return fromProviders;
  return order.indexOf("youtube") <= order.indexOf(fromProviders.provider) ? youtubePlain : fromProviders;
}

/** The line playing at `ms`: the last one that started (binary search; lines are sorted). -1 before the first. */
export function lineAt(lines: LyricLine[], ms: number): number {
  let lo = 0, hi = lines.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

