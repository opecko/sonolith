import { pickSong } from "./songVersions";
import { isEpisode, isShow, type CardAction, type Item, type SearchGroup, type Track } from "./types";

/** Lowercase, no diacritics, punctuation as spaces, single spaces: "Lex Fridman Podcast!" → "lex fridman podcast". */
export function normalizeQuery(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const PODCAST_GROUPS: ReadonlySet<SearchGroup> = new Set(["podcasts", "episodes"]);

/**
 * Is this a search for a podcast? YouTube Music's own top result decides when there is one (a show or episode:
 * yes; a song, artist or album: no, so music searches keep their order). Without one, the best podcast match must
 * be named like the query: equal, or starting with it ("lex fridman" → "Lex Fridman Podcast"); a show that only
 * mentions the name somewhere ("… & Joe Rogan Experience") doesn't count.
 */
export function isPodcastSearch(query: string, top: Item[], groups: { id: SearchGroup; items: Item[] }[]): boolean {
  if (top[0]) return isShow(top[0]) || isEpisode(top[0]);
  const q = normalizeQuery(query);
  const show = groups.find((g) => g.id === "podcasts")?.items[0];
  if (!q || !show) return false;
  const title = normalizeQuery(show.title);
  return title === q || title.startsWith(`${q} `);
}

/** The podcast groups (shows, then episodes) first; everything else keeps YouTube's order. */
export function podcastsFirst<T extends { id: SearchGroup }>(groups: T[]): T[] {
  return [...groups.filter((g) => PODCAST_GROUPS.has(g.id)), ...groups.filter((g) => !PODCAST_GROUPS.has(g.id))];
}

/**
 * A music video as YouTube Music's top result ("Instant Destiny (Official Audio)", "Video • Tame Impala") gives way
 * to the song itself when the results have it (same bare title, a shared artist; songVersions.ts pickSong): the
 * song becomes the top result, the card's Play / Save act on it, and it leaves the list it came from. Anything else
 * stays as it was.
 */
export function preferSongOnTop<G extends { items: Item[] }>(top: Item[], actions: CardAction[], groups: G[]): { top: Item[]; actions: CardAction[]; groups: G[] } {
  const first = top[0];
  if (!first || first.type !== "track" || first.art !== "wide" || first.podcast) return { top, actions, groups };
  const candidates = groups.flatMap((g) => g.items).filter((i): i is Track & Item => i.type === "track" && i.art !== "wide" && !i.podcast);
  const song = pickSong(first as Track, candidates) as (Track & Item) | undefined;
  if (!song) return { top, actions, groups };
  return {
    top: [song, ...top.slice(1)],
    actions: actions.map((a) => (a.videoId === first.id ? { ...a, videoId: song.id } : a)),
    groups: groups.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== song.id) })),
  };
}
