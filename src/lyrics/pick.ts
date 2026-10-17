import type { LyricsProviderId } from "./providers";

/** One line of synced lyrics (ms); `words` when the provider times words / syllables. */
export interface LyricLine {
  start: number;
  end?: number;
  text: string;
  words?: { start: number; end: number; text: string }[];
  /** Background vocals over the line, timed like `words`. */
  background?: { start: number; end: number; text: string }[];
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

export type Tier = "word-synced" | "line-synced" | "unsynced";
const RANK: Record<string, number> = { "word-synced": 3, "line-synced": 2, unsynced: 1 };

/** How good lyrics are: word-synced > line-synced > unsynced. */
export function tierOf(d: Pick<LyricsData, "synced" | "lines">): Tier {
  return !d.synced ? "unsynced" : d.lines.some((l) => l.words?.length) ? "word-synced" : "line-synced";
}

/**
 * The winner among providers' answers (in priority order) and why: the highest tier, the highest priority within
 * it — the backend's rule (src-tauri/src/lyrics/select.rs), for the dev view. Pure.
 */
export function pickWinner(answers: { provider: LyricsProviderId; status: string }[]): { index: number; reason: string } | null {
  let best = -1;
  answers.forEach((a, i) => {
    if ((RANK[a.status] ?? 0) > (RANK[answers[best]?.status] ?? 0)) best = i;
  });
  if (best < 0) return null;
  const tier = answers[best].status;
  const above = answers.slice(0, best).filter((a) => RANK[a.status]);
  const reason = above.length
    ? `${tier} beats ${above.map((a) => `${a.status} from ${a.provider}`).join(", ")} higher in the order`
    : `${tier}, highest in the order`;
  return { index: best, reason };
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

