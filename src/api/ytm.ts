import { getAccountClient, getClient, ytFetch } from "./client";
import { historyPingUrl, makeCpn } from "./history";
import { parseCredits } from "./menu";
import { isEditorialPlaylist, songVersions } from "./songVersions";
import { parseChannel, parseEpisode, parseShow, type PodcastChannel, type PodcastShow } from "./podcast";
import { flattenPage } from "./raw";
import {
  fetchChipTracks, fetchNext, parseLyrics, startRadio as startRadioRaw, type Lyrics, type NextResult, type RadioQueue, type RadioSource, type WatchArgs,
} from "./queue";
import { account, browse, libraryPage, searchPage, suggestions, type Exec, type ListPage } from "./browse";
import {
  mapAlbum, mapArtist, mapHeader, mapTracks,
} from "./mappers";
import type {
  Album, Artist, BrowsePage, BrowseRef, Credits, Item, LibrarySection, Page, Playlist, QueueChip, Rating, SearchGroup, SearchResults, Shelf, Suggestions, Track, TrackMenu,
} from "./types";

// youtubei.js page classes expose continuation helpers; typed loosely since we only use a subset.
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const music = async () => (await getClient()).music;

function shelfPage(p: BrowsePage): Page<Shelf> {
  return {
    items: p.shelves,
    chips: p.chips,
    loadMore: p.next ? async () => shelfPage(await browse(exec, { continuation: p.next! })) : null,
  };
}

/** Home feed; `chip` re-requests it with a mood/genre filter (chip.browse carries FEmusic_home + params). */
export async function getHome(chip?: BrowseRef): Promise<Page<Shelf>> {
  return shelfPage(await browse(exec, chip ?? { browseId: "FEmusic_home" }));
}

export async function getExplore(): Promise<Page<Shelf>> {
  return shelfPage(await browse(exec, { browseId: "FEmusic_explore" }));
}

/** Any browse page (shelf "More" targets, mood categories, …). */
export async function getBrowse(ref: BrowseRef): Promise<Page<Shelf>> {
  return shelfPage(await browse(exec, ref));
}

/** A new playlist; privacy, description and first items only when given (YouTube's defaults otherwise). */
export async function createPlaylist(
  title: string,
  opts: { description?: string; privacy?: "public" | "unlisted" | "private"; videoIds?: string[] } = {},
): Promise<string | undefined> {
  const r = await accountExec("/playlist/create", {
    title,
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.privacy ? { privacyStatus: opts.privacy.toUpperCase() } : {}),
    ...(opts.videoIds?.length ? { videoIds: opts.videoIds } : {}),
  });
  return r?.playlistId;
}

/** Raw WEB_REMIX call (parse:false) for our own defensive parsers. */
export const exec: Exec = async (endpoint, body) =>
  ((await (await getClient()).actions.execute(endpoint, { ...body, client: "YTMUSIC", parse: false })) as N).data;

/** exec for calls that act on the account: signed out, they fail with AuthError before asking YouTube. */
const accountExec: Exec = async (endpoint, body) =>
  ((await (await getAccountClient()).actions.execute(endpoint, { ...body, client: "YTMUSIC", parse: false })) as N).data;

export async function getLibrary(section: LibrarySection): Promise<Page<Item>> {
  const wrap = (p: ListPage): Page<Item> => ({
    items: p.items,
    loadMore: p.next ? async () => wrap(await libraryPage(accountExec, section, p.next!)) : null,
  });
  const first = await libraryPage(accountExec, section);
  return wrap(first);
}

/**
 * Search params for one result type, as YouTube Music's filter chips send them: a type field ("EgWKAQ" + songs II,
 * videos IQ, …; playlists are the "Community playlists" chip) plus a ranking suffix that any of its values works with.
 */
export const SEARCH_FILTERS: Record<SearchGroup, string> = {
  songs: "EgWKAQIIAWoMEBEQEBADEAQQFRAJ",
  videos: "EgWKAQIQAWoMEBEQEBADEAQQFRAJ",
  albums: "EgWKAQIYAWoMEBEQEBADEAQQFRAJ",
  artists: "EgWKAQIgAWoMEBEQEBADEAQQFRAJ",
  playlists: "EgeKAQQoAEABagwQERAQEAMQBBAVEAk=",
  podcasts: "EgWKAQJQAWoMEBEQEBADEAQQFRAJ",
  episodes: "EgWKAQJIAWoMEBEQEBADEAQQFRAJ",
};

/** Songs only, for matching music videos to their songs (songVersions.ts). */
async function searchSongs(query: string): Promise<Track[]> {
  const r = await searchPage(exec, query, SEARCH_FILTERS.songs);
  return [...r.top, ...r.groups.flatMap((g) => g.items), ...r.shelves.flatMap((s) => s.items)].filter((i): i is Track & Item => i.type === "track");
}

export async function getPlaylist(id: string): Promise<Playlist> {
  // YouTube Music's own playlists come as music videos without Premium: shown and played as the songs instead.
  const tracksOf = (p: N) => {
    const tracks = mapTracks(p.items ?? p.contents);
    return isEditorialPlaylist(id) ? songVersions(tracks, searchSongs) : tracks;
  };
  const wrap = async (p: N, base: Omit<Playlist, "tracks" | "loadMore">): Promise<Playlist> => ({
    ...base,
    tracks: await tracksOf(p),
    loadMore: p.has_continuation ? async () => wrap(await p.getContinuation(), base) : null,
  });
  const page: N = await (await music()).getPlaylist(id);
  return wrap(page, { type: "playlist", id, ...mapHeader(page.header) });
}

export async function getAlbum(id: string): Promise<Album> {
  return mapAlbum(id, await (await music()).getAlbum(id));
}

export async function getArtist(id: string): Promise<Artist> {
  return mapArtist(id, await (await music()).getArtist(id));
}

/** Mixed overview (no params) or a single-type list when `params` comes from a filter chip. */
export function search(query: string, params?: string, next?: string): Promise<SearchResults> {
  return searchPage(exec, query, params, next);
}

/** One result type, paged (`next` = the previous page's continuation). */
export function searchByType(query: string, type: SearchGroup, next?: string): Promise<SearchResults> {
  return searchPage(exec, query, SEARCH_FILTERS[type], next);
}

export function getSearchSuggestions(query: string): Promise<Suggestions> {
  return suggestions(exec, query);
}


const RATE_ENDPOINT: Record<Rating, string> = { LIKE: "/like/like", DISLIKE: "/like/dislike", INDIFFERENT: "/like/removelike" };

/** Thumbs up / down / neutral. Sent as the YT Music client (youtubei.js' interact.* uses the YouTube client → 400). */
export async function rate(videoId: string, rating: Rating): Promise<void> {
  await accountExec(RATE_ENDPOINT[rating], { target: { videoId } });
}

export async function addToPlaylist(playlistId: string, videoIds: string | string[]): Promise<void> {
  await (await getAccountClient()).playlist.addVideos(playlistId, Array.isArray(videoIds) ? videoIds : [videoIds]);
}

/**
 * Deletes the user's playlist from their account (no undo). Called directly: youtubei.js's playlist.delete builds an
 * endpoint it can't send ("Expected an api_url").
 */
export async function deletePlaylist(playlistId: string): Promise<void> {
  await accountExec("/playlist/delete", { playlistId });
}

export async function renamePlaylist(playlistId: string, title: string): Promise<void> {
  await (await getAccountClient()).playlist.setName(playlistId, title);
}

/** Fails with "This playlist cannot be edited." for playlists the user doesn't own. */
export async function removeFromPlaylist(playlistId: string, videoIds: string | string[]): Promise<void> {
  await (await getAccountClient()).playlist.removeVideos(playlistId, Array.isArray(videoIds) ? videoIds : [videoIds]);
}

/**
 * Saves an album or someone else's playlist to the library, or removes it. Albums are saved through their audio
 * playlist (OLAK5uy_…), which only the album page names.
 */
export async function setSaved(item: { type: "album" | "playlist"; id: string }, saved: boolean): Promise<void> {
  let playlistId = item.id;
  if (item.type === "album") {
    const page = JSON.stringify(await exec("/browse", { browseId: item.id }));
    const found = /"(OLAK5uy_[\w-]+)"/.exec(page)?.[1];
    if (!found) throw new Error("No playlist for this album");
    playlistId = found;
  }
  await accountExec(saved ? "/like/like" : "/like/removelike", { target: { playlistId } });
}

/** Raw /next for a video and/or queue (chips, header, related/lyrics tabs, automix seed). */
export function getWatch(args: WatchArgs | { continuation: string }): Promise<NextResult> {
  return fetchNext(exec, args);
}

export function getChipTracks(chip: QueueChip, currentId: string) {
  return fetchChipTracks(exec, chip, currentId);
}

export function getAccount() {
  return account(accountExec);
}

/** Central "Start radio": resolves the radio endpoint for any source and returns the first page. */
export function startRadio(source: RadioSource): Promise<RadioQueue> {
  return startRadioRaw(exec, source);
}

/** "Related" tab of the watch page (MPTRt… browse). */
export async function getRelated(ref: BrowseRef): Promise<Shelf[]> {
  return (await browse(exec, ref)).shelves;
}

/** "Lyrics" tab (MPLYt… browse); null when the page has no lyrics text. */
export async function getLyrics(ref: BrowseRef): Promise<Lyrics | null> {
  return parseLyrics(await exec("/browse", { ...ref }));
}

/** Adds a play of `videoId` to the account's YouTube Music history. */
export async function recordHistory(videoId: string): Promise<void> {
  const url = historyPingUrl(await accountExec("/player", { videoId }), makeCpn());
  if (!url) throw new Error("No playback tracking URL in the player response");
  const res = await ytFetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`History ping failed: HTTP ${res.status}`);
}

/** Sends a menu feedback token (library save/remove, pin, remove from history, …). */
export async function sendFeedback(token: string): Promise<void> {
  const r = await accountExec("/feedback", { feedbackTokens: [token] });
  const ok = (r?.feedbackResponses ?? []).every((f: { isProcessed?: boolean }) => f?.isProcessed !== false);
  if (!ok) throw new Error("YouTube Music did not accept the change");
}

const menuCache = new Map<string, Promise<TrackMenu | undefined>>();

/** Full menu data for a track, from its queue item in /next (works for tracks parsed without menus). */
export function getTrackMenu(videoId: string): Promise<TrackMenu | undefined> {
  let p = menuCache.get(videoId);
  if (!p) {
    p = fetchNext(exec, { videoId }).then((r) => r.tracks.find((t) => t.id === videoId)?.menu);
    p.catch(() => menuCache.delete(videoId));
    menuCache.set(videoId, p);
  }
  return p;
}

export async function getCredits(browseId: string): Promise<Credits> {
  const c = parseCredits(await exec("/browse", { browseId }));
  if (!c) throw new Error("No credits for this song");
  return c;
}

/** Listening history grouped by day ("Today", "Yesterday", …); `chip` = Music / Podcasts filter. */
export async function getHistory(chip?: BrowseRef): Promise<Page<Shelf>> {
  return shelfPage(await browse(accountExec, chip ?? { browseId: "FEmusic_history" }));
}

// ---------- podcasts ----------

/** Podcast show page by playlist id (the MPSP-prefixed browse id). */
export async function getPodcastShow(playlistId: string): Promise<PodcastShow> {
  return parseShow(await exec("/browse", { browseId: playlistId.startsWith("MPSP") ? playlistId : `MPSP${playlistId}` }));
}

/** An episode page by video id; null when YouTube has no episode page for it. */
export async function getEpisode(videoId: string): Promise<Track | null> {
  return parseEpisode(videoId, await exec("/browse", { browseId: `MPED${videoId}` }));
}

/** Episode list for a filter chip / sort option, or the next page of it. */
export async function getEpisodes(token: string): Promise<Page<Track>> {
  const p = flattenPage(await browse(exec, { continuation: token }));
  const items = p.items.filter((i): i is Track & Item => i.type === "track");
  return { items, loadMore: p.next ? () => getEpisodes(p.next!) : null };
}

export async function setPodcastSaved(playlistId: string, saved: boolean): Promise<void> {
  await accountExec(saved ? "/like/like" : "/like/removelike", { target: { playlistId } });
}

export async function getChannel(id: string): Promise<PodcastChannel> {
  return parseChannel(id, await exec("/browse", { browseId: id }));
}

export async function setSubscribed(channelId: string, on: boolean): Promise<void> {
  await accountExec(on ? "/subscription/subscribe" : "/subscription/unsubscribe", { channelIds: [channelId] });
}
