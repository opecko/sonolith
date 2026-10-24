// Answers the API methods that need the frontend (src-tauri/src/api/methods.rs: Handler::Frontend), with the same
// stores and YouTube calls the UI uses. Params arrive checked against the spec (src-tauri/src/api/validate.rs).
import type { Item as AppItem, Page, SearchGroup, Shelf, Track } from "../api/types";
import {
  getAlbum, getArtist, getEpisode, getEpisodes, getHistory, getLibrary, getPlaylist, getPlaylistEntries, getPodcastShow, getSearchSuggestions,
  getWatch, rate, removeFromPlaylist, addToPlaylist, search, searchByType, setPodcastSaved, setSaved,
} from "../api/ytm";
import { findLyrics, useLyrics } from "../lyrics/store";
import { useLibrary } from "../stores/library";
import { getAudio, playbackTime, usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import * as C from "./convert";
import { ApiError, bridgeError, invalidParam, notFound, nothingPlaying } from "./errors";
import { page, slice, sliceCursor } from "./paging";
import { canGoNext, ctx, queueEntryIds, queueRevision, queueSummary } from "./publish";
import type * as A from "./schema.gen";

export interface Call {
  appId: string;
  scopes: A.Scope[];
  /** Aborted when the server gave up on the call (timeout) or the app's connection closed. */
  signal?: AbortSignal;
}

type P<M extends A.MethodName> = A.Methods[M]["params"];
type R<M extends A.MethodName> = A.Methods[M]["result"];
type Handler<M extends A.MethodName> = (params: P<M>, call: Call) => Promise<R<M>> | R<M>;

const player = () => usePlayer.getState();
const current = (): Track | undefined => player().queue[player().index];
const requireCurrent = (): Track => current() ?? (() => { throw nothingPlaying(); })();
const libraryCtx = (call: Call) => ctx(call.scopes.includes("library:read"));
/** Album, playlist and podcast items added at most per reference (api/SPEC.md queue.add). */
const MAX_ITEMS = 500;
/** Entries one queue.add / queue.playNext adds at most, whatever the references hold. */
const MAX_CALL_ITEMS = 1000;
/** Apps don't grow the queue past this (the UI itself isn't limited). */
const MAX_QUEUE = 5000;
/** References looked up at once: 50 playlists must not mean 50 parallel YouTube requests. */
const LOOKUPS = 4;

/** A playlist id without the `VL` browse prefix, which YouTube also accepts ("VLLM" is liked songs too). */
const playlistId = (id: string) => id.replace(/^(VL)+/, "");
/**
 * The user's automatic lists, which are library data: liked songs, episodes for later, liked videos, watch later,
 * new episodes of followed podcasts, and the mixes made from their listening (Replay Mix, My Supermix).
 */
const PERSONAL_LISTS = /^(LM|SE|LL|WL|RDPN)$|^RDTMAK5uy_/;

// ---------------------------------------------------------------- resolving references

/** A track or episode by id, with the metadata the player needs (/next knows every playable video). */
async function mediaTrack(ref: { type: "track" | "episode"; id: string }): Promise<Track> {
  if (ref.type === "episode") {
    const e = await getEpisode(ref.id).catch(() => null);
    if (e) return e;
  }
  const w = await getWatch({ videoId: ref.id });
  const t = w.tracks.find((x) => x.id === ref.id);
  if (!t) throw notFound();
  return ref.type === "episode" ? { ...t, podcast: true } : t;
}

/** Items from `first` and its following pages, at most `max`; stops between pages once the call is cancelled. */
async function allPages(first: Page<Track>, max: number, signal?: AbortSignal): Promise<Track[]> {
  let p = first;
  const all = [...p.items];
  while (p.loadMore && all.length < max) {
    signal?.throwIfAborted();
    p = await p.loadMore();
    all.push(...p.items);
  }
  return all.slice(0, max);
}

const playlistPage = (pl: Awaited<ReturnType<typeof getPlaylist>>): Page<Track> => ({
  items: pl.tracks,
  loadMore: pl.loadMore ? async () => playlistPage(await pl.loadMore!()) : null,
});

/** Every entry of a playlist (up to 100 pages), to look entries up by their ids. */
async function allEntries(id: string, signal?: AbortSignal): Promise<Track[]> {
  let p: Page<Track> = await getPlaylistEntries(id);
  const all = [...p.items];
  for (let i = 0; p.loadMore && i < 100; i++) {
    signal?.throwIfAborted();
    p = await p.loadMore();
    all.push(...p.items);
  }
  return all;
}

async function podcastEpisodes(id: string, max: number, signal?: AbortSignal): Promise<Track[]> {
  const show = await getPodcastShow(id);
  if (!show.title) throw notFound();
  const withShow = (t: Track): Track => ({ ...t, show: t.show ?? { id, title: show.title } });
  const first: Page<Track> = { items: show.episodes, loadMore: show.next ? () => getEpisodes(show.next!) : null };
  return (await allPages(first, max, signal)).map(withShow);
}

/**
 * Refuses, for an app without `library:read`, what is library data: the user's automatic lists and personal mixes
 * (by id) and their own playlists, public or not (from YouTube's page, which doesn't depend on the library being
 * loaded). Returns the first page of entries it read, if any.
 */
async function libraryGuard(id: string, call: Call): Promise<Awaited<ReturnType<typeof getPlaylistEntries>> | null> {
  if (call.scopes.includes("library:read")) return null;
  if (PERSONAL_LISTS.test(id)) throw notFound();
  const entries = await about(() => getPlaylistEntries(id));
  if (entries.own) throw notFound();
  return entries;
}

/** Everything a playable reference stands for, in order, at most `max` items. */
async function tracksOf(ref: A.PlayableRef, call: Call, max = MAX_ITEMS): Promise<{ tracks: Track[]; context: { playlistId?: string; title?: string } }> {
  max = Math.min(max, MAX_ITEMS);
  switch (ref.type) {
    case "track":
    case "episode":
      return { tracks: [await mediaTrack({ type: ref.type, id: ref.id })], context: {} };
    case "album": {
      const a = await getAlbum(ref.id);
      if (!a.title && !a.tracks.length) throw notFound();
      return { tracks: a.tracks.slice(0, max), context: { title: a.title } };
    }
    case "playlist": {
      const id = playlistId(ref.id);
      await libraryGuard(id, call);
      const pl = await getPlaylist(id);
      return { tracks: await allPages(playlistPage(pl), max, call.signal), context: { playlistId: id, title: pl.title } };
    }
    case "podcast":
      return { tracks: await podcastEpisodes(ref.id, max, call.signal), context: {} };
  }
}

/**
 * The tracks of several references in order, at most `max` together. They are looked up `LOOKUPS` at a time, and
 * references after the first `max` tracks are not looked up at all.
 */
async function tracksOfAll(refs: A.PlayableRef[], call: Call, max: number): Promise<Track[]> {
  const lists: Track[][] = [];
  let total = 0;
  let next = 0;
  const worker = async () => {
    while (next < refs.length && total < max) {
      call.signal?.throwIfAborted();
      const i = next++;
      try {
        lists[i] = (await about(() => tracksOf(refs[i], call, max - total))).tracks;
      } catch (e) {
        next = refs.length; // the other workers stop too
        throw e;
      }
      total += lists[i].length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUPS, refs.length) }, worker));
  return lists.flat().slice(0, max);
}

/** Errors of YouTube calls about one item: unknown ids are NotFound, signed-out calls NotSignedIn. */
async function about<T>(fn: () => Promise<T>, opts: { editable?: boolean } = {}): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const b = bridgeError(e, { missing: true, editable: opts.editable });
    throw new ApiError(b.name as A.ErrorName, (b.reason as string | null) ?? null);
  }
}

// ---------------------------------------------------------------- queue helpers

function queueEntries(call: Call): A.QueueEntry[] {
  const { queue } = player();
  const ids = queueEntryIds();
  const c = libraryCtx(call);
  return queue.map((t, index) => ({ index, entryId: ids[index], item: C.mediaItem(t, c), autoplay: t.source === "autoplay" }));
}

/** How many entries one call may still add: per-call and queue limits. */
const queueRoom = () => Math.max(0, Math.min(MAX_CALL_ITEMS, MAX_QUEUE - player().queue.length));

/**
 * What a queue.add / queue.playNext adds, and whether the limits left items out. One track more than fits is looked
 * up, so a list that just fits isn't called truncated; with no room at all nothing is looked up.
 */
async function forQueue(refs: A.PlayableRef[], call: Call): Promise<{ tracks: Track[]; truncated: boolean; limit: number }> {
  const room = queueRoom();
  const found = room > 0 ? await tracksOfAll(refs, call, room + 1) : [];
  call.signal?.throwIfAborted();
  // The queue may have changed during the lookup.
  const limit = queueRoom();
  return { tracks: found.slice(0, limit), truncated: room === 0 || found.length > limit, limit };
}

function indexOfEntry(entryId: string): number {
  return queueEntryIds().indexOf(entryId);
}

/** Removes queue entries; the playing one gives way to the next (or playback stops at the end). */
function removeEntries(indexes: number[]): number {
  const s = player();
  const doomed = new Set(indexes.filter((i) => i >= 0 && i < s.queue.length));
  if (!doomed.size) return 0;
  if (doomed.has(s.index)) {
    const next = s.queue.findIndex((_, i) => i > s.index && !doomed.has(i));
    if (next >= 0) s.playIndex(next);
    else {
      // Nothing left after it: stopped, with what is left of the queue ready to play again.
      getAudio().pause();
      const kept = s.queue.filter((_, i) => !doomed.has(i));
      usePlayer.setState({ queue: kept, index: kept.length ? kept.length - 1 : -1, status: "idle" });
      return doomed.size;
    }
  }
  const p = player();
  const keep = p.queue.filter((_, i) => !doomed.has(i));
  const index = p.index - [...doomed].filter((i) => i < p.index).length;
  usePlayer.setState({ queue: keep, index });
  return doomed.size;
}

// ---------------------------------------------------------------- handlers

const handlers: { [M in A.MethodName]?: Handler<M> } = {
  "player.play": () => {
    requireCurrent();
    player().setPlaying(true);
    return {};
  },
  "player.pause": () => {
    if (current()) player().setPlaying(false);
    return {};
  },
  "player.toggle": () => {
    requireCurrent();
    player().togglePlay();
    return {};
  },
  "player.next": () => {
    requireCurrent();
    if (!canGoNext()) throw new ApiError("Unavailable");
    player().next();
    return {};
  },
  "player.previous": () => {
    requireCurrent();
    player().prev();
    return {};
  },
  "player.seek": (p) => {
    requireCurrent();
    const d = getAudio().duration;
    const target = p.positionMs !== undefined ? p.positionMs / 1000 : playbackTime() + (p.offsetMs ?? 0) / 1000;
    player().seek(Math.max(0, Number.isFinite(d) ? Math.min(d, target) : target));
    return {};
  },
  "player.setVolume": (p) => {
    if (p.volume !== undefined) player().setVolume(p.volume / 100);
    if (p.muted !== undefined && p.muted !== player().muted) player().toggleMute();
    return {};
  },
  "player.setShuffle": (p) => {
    if (p.enabled !== player().shuffle) player().toggleShuffle();
    return {};
  },
  "player.setRepeat": (p) => {
    usePlayer.setState({ repeat: p.mode });
    return {};
  },
  "player.setRate": (p) => {
    useSettings.getState().set({ podcastSpeed: p.rate });
    return {};
  },
  "player.playItem": async (p, call) => {
    const { tracks, context } = await about(() => tracksOf(p.item, call));
    call.signal?.throwIfAborted();
    if (!tracks.length) throw new ApiError("Unavailable", "notPlayable");
    const single = p.item.type === "track" || p.item.type === "episode";
    let index = 0;
    if (!single && p.startId !== undefined) {
      index = tracks.findIndex((t) => t.id === p.startId);
      if (index < 0) throw invalidParam("/startId");
    } else if (!single && p.shuffle) index = Math.floor(Math.random() * tracks.length);
    if (!single && p.shuffle && !player().shuffle) player().toggleShuffle();
    player().playQueue(tracks, index, context, p.positionMs !== undefined ? p.positionMs / 1000 : undefined);
    return {};
  },

  "queue.get": (p, call) => {
    const rev = queueRevision();
    const from = p.cursor !== undefined ? sliceCursor(p.cursor, rev) : Math.min(p.fromIndex ?? 0, player().queue.length);
    return { ...queueSummary(), ...slice(queueEntries(call), from, p.limit, rev) };
  },
  "queue.add": async (p, call) => {
    const { tracks, truncated, limit } = await forQueue(p.items, call);
    const before = player().queue.length;
    player().addToQueue(tracks);
    return { added: player().queue.length - before, truncated, limit, queue: queueSummary() };
  },
  "queue.playNext": async (p, call) => {
    const { tracks, truncated, limit } = await forQueue(p.items, call);
    const before = player().queue.length;
    player().playNext(tracks);
    return { added: Math.max(player().queue.length - before, 0), truncated, limit, queue: queueSummary() };
  },
  "queue.move": (p) => {
    const from = indexOfEntry(p.entryId);
    if (from < 0) throw notFound();
    player().moveTrack(from, Math.max(0, Math.min(p.toIndex, player().queue.length - 1)));
    return { queue: queueSummary() };
  },
  "queue.remove": (p) => {
    const ids = queueEntryIds();
    const removed = removeEntries(p.entryIds.map((id) => ids.indexOf(id)));
    return { removed, queue: queueSummary() };
  },
  "queue.clear": () => {
    player().clearQueue();
    return { queue: queueSummary() };
  },
  "queue.setAutoplay": (p) => {
    player().setAutoplay(p.enabled);
    return { queue: queueSummary() };
  },

  "library.playlists": (p) => page(`playlists`, p.cursor, p.limit, () => getLibrary("playlists"), (i) => (i.type === "playlist" && !i.podcast ? C.playlist(i) : null)),
  "library.likedSongs": (p, call) => page(`liked`, p.cursor, p.limit, () => getLibrary("liked"), (i) => (i.type === "track" ? C.mediaItem(i, libraryCtx(call)) : null)),
  "library.albums": (p) => page(`albums`, p.cursor, p.limit, () => getLibrary("albums"), (i) => (i.type === "album" ? C.album(i) : null)),
  "library.artists": (p) => page(`artists`, p.cursor, p.limit, () => getLibrary("artists"), (i) => (i.type === "artist" && !i.channel ? C.artist(i) : null)),
  "library.podcasts": (p) => page(`podcasts`, p.cursor, p.limit, () => getLibrary("podcasts"), (i) => (i.type === "playlist" ? C.podcast(i) : null)),
  "library.episodesForLater": (p, call) => page(`episodes`, p.cursor, p.limit, () => getLibrary("episodes"), (i) => (i.type === "track" ? C.episode(i, libraryCtx(call)) : null)),
  "library.history": (p, call) =>
    page(`history`, p.cursor, p.limit, async () => historyPage(await getHistory()), (h: { item: AppItem; section: string }) => {
      if (h.item.type !== "track") return null;
      return { item: C.mediaItem(h.item, libraryCtx(call)), sectionText: h.section || null };
    }),

  "playlist.get": async (p, call) => {
    const lib = call.scopes.includes("library:read");
    const id = playlistId(p.id);
    // Without library access, only other people's public and unlisted playlists (a cursor was checked on page one).
    const entries = p.cursor !== undefined ? null : await libraryGuard(id, call);
    const pl = await about(() => getPlaylist(id));
    if (!pl.title && !pl.tracks.length) throw notFound();
    const listed = useLibrary.getState().playlists?.find((x) => x.id === id);
    const detail: A.PlaylistDetail = { ...C.playlist({ ...pl, subtitle: listed?.subtitle ?? pl.subtitle }), description: null, privacy: null };
    const c = libraryCtx(call);
    // Entries come from the raw page: only it has each entry's own id (the same song twice has two). The key keeps a
    // cursor from a call with library access out of one without.
    const first = () => (entries ? Promise.resolve(entries) : about(() => getPlaylistEntries(id)));
    const r = await page(`playlist:${id}:${lib ? "library" : "public"}`, p.cursor, p.limit, first, (t: Track): A.PlaylistEntry => ({ entryId: t.setVideoId ?? null, item: C.mediaItem(t, c) }));
    return { playlist: detail, ...r };
  },
  "playlist.create": async (p, call) => {
    const ids = (await tracksOfAll(p.items ?? [], call, Infinity)).map((t) => t.id);
    call.signal?.throwIfAborted();
    const id = await useLibrary.getState().create(p.title, { description: p.description, privacy: p.privacy, videoIds: ids });
    if (!id) throw new ApiError("InternalError");
    return { type: "playlist", id, title: p.title, author: null, trackCount: ids.length, thumbnailUrl: null, editable: true };
  },
  "playlist.rename": async (p) => {
    await about(() => useLibrary.getState().rename(p.id, p.title), { editable: true });
    return {};
  },
  "playlist.delete": async (p) => {
    await about(() => useLibrary.getState().remove(p.id), { editable: true });
    return {};
  },
  "playlist.addTracks": async (p, call) => {
    let ids = [...new Set(p.items.map((i) => i.id))];
    let skipped = p.items.length - ids.length;
    if (!p.allowDuplicates) {
      const have = new Set((await about(async () => allPages(playlistPage(await getPlaylist(p.id)), MAX_ITEMS, call.signal))).map((t) => t.id));
      skipped += ids.filter((id) => have.has(id)).length;
      ids = ids.filter((id) => !have.has(id));
    } else {
      ids = p.items.map((i) => i.id);
      skipped = 0;
    }
    call.signal?.throwIfAborted();
    if (ids.length) {
      await about(() => addToPlaylist(p.id, ids), { editable: true });
      useLibrary.getState().adjustCount(p.id, ids.length);
      useLibrary.getState().changed();
    }
    return { added: ids.length, skipped };
  },
  "playlist.removeTracks": async (p, call) => {
    // Exactly the entries asked for (not every copy of a song); ids the playlist doesn't have are ignored.
    const want = new Set(p.entryIds);
    const present = (await about(() => allEntries(p.id, call.signal))).filter((t) => t.setVideoId && want.has(t.setVideoId)).map((t) => t.setVideoId!);
    call.signal?.throwIfAborted();
    if (present.length) {
      await about(() => removeFromPlaylist(p.id, present, true), { editable: true });
      useLibrary.getState().adjustCount(p.id, -present.length);
      useLibrary.getState().changed();
    }
    return { removed: present.length };
  },

  "search.query": async (p, call) => {
    const type = p.type ?? "all";
    const c = libraryCtx(call);
    if (type === "all") {
      const r = await search(p.query);
      const top = C.items(r.top, c)[0] ?? null;
      const rest = C.items([...r.groups.flatMap((g) => g.items), ...r.shelves.flatMap((s) => s.items)], c);
      return { topResult: top, items: rest.slice(0, p.limit ?? 50), nextCursor: null };
    }
    const group = type as SearchGroup;
    const results = (next?: string): Promise<Page<AppItem>> =>
      searchByType(p.query, group, next).then((r) => ({
        items: [...r.top, ...r.groups.flatMap((g) => g.items), ...r.shelves.flatMap((s) => s.items)],
        loadMore: r.next ? () => results(r.next!) : null,
      }));
    const want = SEARCH_TYPES[group];
    const r = await page(`search:${group}:${p.query}`, p.cursor, p.limit, () => results(), (i: AppItem) => {
      const x = C.item(i, c, group === "videos");
      return x && want.includes(x.type) ? x : null;
    });
    return { topResult: null, ...r };
  },
  "search.suggestions": async (p, call) => {
    const s = await getSearchSuggestions(p.query);
    return { queries: s.queries, items: C.items(s.items, libraryCtx(call)) };
  },

  "browse.album": async (p, call) => {
    const a = await about(() => getAlbum(p.id));
    if (!a.title && !a.tracks.length) throw notFound();
    return C.albumDetail(a, libraryCtx(call));
  },
  "browse.artist": async (p, call) => {
    const a = await about(() => getArtist(p.id));
    if (!a.title) throw notFound();
    return C.artistDetail(a, libraryCtx(call));
  },
  "browse.podcast": async (p, call) => {
    const show = await about(() => getPodcastShow(p.id));
    if (!show.title) throw notFound();
    const podcast: A.PodcastDetail = {
      type: "podcast", id: p.id, title: show.title, author: show.channel?.name ?? null, thumbnailUrl: C.thumb(show.thumbnail), description: show.description ?? null,
    };
    const c = libraryCtx(call);
    const first: Page<Track> = { items: show.episodes, loadMore: show.next ? () => getEpisodes(show.next!) : null };
    const r = await page(`podcast:${p.id}`, p.cursor, p.limit, async () => first, (t: Track) => C.episode({ ...t, show: t.show ?? { id: p.id, title: show.title } }, c));
    return { podcast, ...r };
  },
  "browse.episode": async (p, call) => {
    const e = await about(() => getEpisode(p.id));
    if (!e) throw notFound();
    return { ...C.episode(e, libraryCtx(call)), description: e.episode?.description ?? null };
  },

  "rating.set": async (p) => {
    const { item, rating } = p;
    if (item.type === "track" || item.type === "episode") {
      await about(() => rate(item.id, C.APP_RATING[rating]));
      usePlayer.setState((s) => ({ ratings: { ...s.ratings, [item.id]: C.APP_RATING[rating] } }));
      // Like YouTube Music: disliking the playing song skips it.
      if (rating === "dislike" && current()?.id === item.id) player().next();
      return {};
    }
    if (rating === "dislike") throw invalidParam("/rating");
    const saved = rating === "like";
    const kind = item.type;
    await about(() => (kind === "podcast" ? setPodcastSaved(item.id, saved) : setSaved({ type: kind, id: item.id }, saved)));
    if (item.type === "playlist") useLibrary.getState().changed();
    return {};
  },

  "lyrics.get": async (p) => {
    const playing = current();
    const id = p.trackId ?? playing?.id;
    if (!id) throw nothingPlaying();
    if (playing?.id === id) {
      if (playing.podcast) return C.lyricsResult(id, null);
      const l = useLyrics.getState();
      if (l.id === id && l.status === "done") return C.lyricsResult(id, l.data);
      return C.lyricsResult(id, await findLyrics(playing));
    }
    const t = await about(() => mediaTrack({ type: "track", id }));
    return C.lyricsResult(id, t.podcast ? null : await findLyrics(t));
  },
};

/** Item types each search filter may return (YouTube mixes a few others in). */
const SEARCH_TYPES: Record<SearchGroup, A.ItemType[]> = {
  songs: ["track"], videos: ["track"], albums: ["album"], artists: ["artist"], playlists: ["playlist"], podcasts: ["podcast"], episodes: ["episode"],
};

/** History shelves ("Today", "Yesterday", …) as one list of entries with their section. */
function historyPage(p: Page<Shelf>): Page<{ item: AppItem; section: string }> {
  return {
    items: p.items.flatMap((s) => s.items.map((item) => ({ item, section: s.title }))),
    loadMore: p.loadMore ? async () => historyPage(await p.loadMore!()) : null,
  };
}

/** Answers one call, or throws (an ApiError, or anything a store or YouTube call threw). */
export async function dispatch(method: string, params: Record<string, unknown>, call: Call): Promise<unknown> {
  const h = handlers[method as A.MethodName] as Handler<A.MethodName> | undefined;
  if (!h) throw new ApiError("MethodNotFound");
  return h(params as P<A.MethodName>, call);
}
