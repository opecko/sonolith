// Raw InnerTube calls shared by the app (ytm.ts) and scripts/dbg.ts.
import { bestThumb, flattenPage, mapRawItem, parseBrowse, runsText } from "./raw";
import { isPodcastSearch, podcastsFirst, preferSongOnTop } from "./searchOrder";
import type {
  BrowsePage, BrowseRef, Continuation, Item, LibrarySection, SearchGroup, SearchResults, Suggestions,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Exec = (endpoint: string, body: Record<string, unknown>) => Promise<any>;

export const LIBRARY_BROWSE: Record<LibrarySection, string> = {
  playlists: "FEmusic_liked_playlists",
  songs: "FEmusic_liked_videos",
  albums: "FEmusic_liked_albums",
  artists: "FEmusic_library_corpus_artists",
  liked: "VLLM",
  podcasts: "FEmusic_library_non_music_audio_list",
  episodes: "VLSE",
};

export async function browse(exec: Exec, ref: BrowseRef | { continuation: Continuation }): Promise<BrowsePage> {
  return parseBrowse(await exec("/browse", { ...ref }));
}

export interface ListPage {
  items: Item[];
  next: Continuation | null;
  messages: string[];
}

export async function libraryPage(exec: Exec, section: LibrarySection, next?: Continuation): Promise<ListPage> {
  const page = await browse(exec, next ? { continuation: next } : { browseId: LIBRARY_BROWSE[section] });
  const flat = flattenPage(page);
  // Avoid loops if the server hands back the same token.
  return { ...flat, next: flat.next && flat.next !== next ? flat.next : null };
}


export function groupOf(i: Item): SearchGroup {
  switch (i.type) {
    case "track":
      return i.podcast ? "episodes" : i.art === "wide" ? "videos" : "songs";
    case "playlist":
      return i.podcast ? "podcasts" : "playlists";
    case "album":
      return "albums";
    case "artist":
      return "artists";
  }
}

/** Search results; with the query, a podcast search gets its podcast groups first (searchOrder.ts). */
export function toSearchResults(page: BrowsePage, query = ""): SearchResults {
  const top = page.shelves.filter((s) => s.layout === "card").flatMap((s) => s.items);
  const topActions = page.shelves.find((s) => s.layout === "card")?.actions ?? [];
  const shelves = page.shelves.filter((s) => s.layout !== "card" && s.title && s.items.length);
  const loose = page.shelves.filter((s) => s.layout !== "card" && !s.title).flatMap((s) => s.items);
  const buckets = new Map<SearchGroup, Item[]>();
  for (const i of loose) buckets.set(groupOf(i), [...(buckets.get(groupOf(i)) ?? []), i]);
  const next = page.shelves.find((s) => s.next)?.next ?? page.next;
  // In YouTube Music's order (the order the groups first appear), unless it's a search for a podcast.
  const inOrder = [...buckets.keys()].map((id) => ({ id, items: buckets.get(id)! }));
  const podcastFirst = isPodcastSearch(query, top, inOrder);
  // The song rather than its video on top (searchOrder.ts).
  const preferred = preferSongOnTop(top, topActions, podcastFirst ? podcastsFirst(inOrder) : inOrder);
  return {
    top: preferred.top,
    topActions: preferred.actions,
    shelves,
    groups: preferred.groups,
    podcastFirst,
    chips: page.chips,
    messages: page.messages,
    next: next ?? null,
  };
}

export async function searchPage(exec: Exec, query: string, params?: string, next?: Continuation): Promise<SearchResults> {
  const body = next ? { continuation: next } : { query, ...(params ? { params } : {}) };
  const res = toSearchResults(parseBrowse(await exec("/search", body)), query);
  // Only filtered (single-type) results page; the mixed overview is complete as returned.
  return { ...res, next: params && res.next && res.next !== next ? res.next : null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSuggestions(data: any): Suggestions {
  const out: Suggestions = { queries: [], items: [] };
  for (const sec of data?.contents ?? []) {
    for (const c of sec?.searchSuggestionsSectionRenderer?.contents ?? []) {
      const q = c?.searchSuggestionRenderer?.navigationEndpoint?.searchEndpoint?.query ?? runsText(c?.searchSuggestionRenderer?.suggestion);
      if (q) out.queries.push(q);
      else {
        const item = mapRawItem(c);
        if (item) out.items.push(item);
      }
    }
  }
  return out;
}

export async function suggestions(exec: Exec, input: string): Promise<Suggestions> {
  return parseSuggestions(await exec("/music/get_search_suggestions", { input }));
}

export interface Account {
  name: string;
  handle?: string;
  photo?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAccount(data: any): Account | null {
  const header = data?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.header?.activeAccountHeaderRenderer;
  if (!header) return null;
  return {
    name: runsText(header.accountName),
    handle: runsText(header.channelHandle) || undefined,
    photo: bestThumb(header.accountPhoto?.thumbnails, 64),
  };
}

export async function account(exec: Exec): Promise<Account | null> {
  return parseAccount(await exec("/account/account_menu", {}));
}
