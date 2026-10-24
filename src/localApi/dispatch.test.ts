// The dispatcher with the stores and YouTube calls replaced by fakes: each method reaches the right call with the
// right arguments, and errors come out as the API's errors.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item, Page, Track } from "../api/types";

const h = vi.hoisted(() => ({
  AuthError: class extends Error {},
  ytm: {} as Record<string, ReturnType<typeof vi.fn>>,
  library: {} as Record<string, ReturnType<typeof vi.fn>>,
  settingsSet: undefined as unknown as ReturnType<typeof vi.fn>,
  audio: { duration: NaN as number, pause: () => {} },
  lyrics: { id: null as string | null, status: "idle", data: null as unknown },
  findLyrics: undefined as unknown as ReturnType<typeof vi.fn>,
  playbackTime: { value: 0 },
}));

vi.mock("../api/client", () => ({ AuthError: h.AuthError }));
const FakeAuthError = h.AuthError;
vi.mock("../api/ytm", () => {
  for (const n of ["getAlbum", "getArtist", "getEpisode", "getEpisodes", "getHistory", "getLibrary", "getPlaylist", "getPlaylistEntries", "getPodcastShow", "getSearchSuggestions",
    "getWatch", "rate", "removeFromPlaylist", "addToPlaylist", "search", "searchByType", "setPodcastSaved", "setSaved"]) h.ytm[n] = vi.fn();
  return h.ytm;
});
vi.mock("../stores/library", () => {
  for (const n of ["create", "rename", "remove", "adjustCount", "changed"]) h.library[n] = vi.fn();
  return { useLibrary: { getState: () => ({ ...h.library, playlists: [{ type: "playlist", id: "PLmine", title: "Mine", subtitle: "3 tracks" }] }) } };
});
vi.mock("../stores/settings", () => {
  h.settingsSet = vi.fn();
  return { useSettings: { getState: () => ({ set: h.settingsSet, autoplay: true, podcastSpeed: 1 }) } };
});
vi.mock("../lyrics/store", () => {
  h.findLyrics = vi.fn();
  return { findLyrics: h.findLyrics, useLyrics: { getState: () => h.lyrics } };
});
vi.mock("./publish", async () => {
  const { usePlayer } = await import("../stores/player");
  return {
    ctx: (library: boolean) => ({ library }),
    canGoNext: () => usePlayer.getState().index + 1 < usePlayer.getState().queue.length,
    queueRevision: () => 1,
    queueSummary: () => ({ revision: 1, currentIndex: usePlayer.getState().index, length: usePlayer.getState().queue.length, autoplay: true }),
    queueEntryIds: () => usePlayer.getState().queue.map((t: Track) => t.id),
  };
});
vi.mock("../stores/player", async () => {
  const { create } = await import("zustand");
  const fn = vi.fn;
  const usePlayer = create(() => ({
    queue: [] as Track[], index: -1, status: "paused", shuffle: false, repeat: "off", volume: 0.8, muted: false, ratings: {}, context: {},
    playQueue: fn(), playNext: fn(), moveTrack: fn(), clearQueue: fn(), setAutoplay: fn(), next: fn(), prev: fn(), setPlaying: fn(), togglePlay: fn(),
    seek: fn(), setVolume: fn(), toggleMute: fn(), toggleShuffle: fn(), playIndex: fn(),
    addToQueue: (tracks: Track[]) => usePlayer.setState((s: { queue: Track[] }) => ({ queue: [...s.queue, ...tracks] })),
  }));
  return { usePlayer, getAudio: () => h.audio, playbackTime: () => h.playbackTime.value };
});

import { usePlayer } from "../stores/player";
import { dispatch, type Call } from "./dispatch";
import { bridgeError, ApiError } from "./errors";

const player = () => usePlayer.getState() as unknown as Record<string, ReturnType<typeof vi.fn>> & { queue: Track[]; index: number };
const song = (id: string, extra: Partial<Track> = {}): Track => ({ type: "track", id, title: `Song ${id}`, subtitle: "", artists: ["A"], durationSec: 100, ...extra });
const page = <T,>(items: T[], loadMore: Page<T>["loadMore"] = null): Page<T> => ({ items, loadMore });
const ALL = ["player:read", "player:control", "queue:read", "queue:write", "library:read", "library:write", "search", "lyrics:read"] as Call["scopes"];
const call = (scopes: Call["scopes"] = ALL): Call => ({ appId: "com.example.test", scopes });
const run = (method: string, params: Record<string, unknown> = {}, scopes?: Call["scopes"]) => dispatch(method, params, call(scopes)) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fails = async (p: Promise<unknown>) => bridgeError(await p.then(() => { throw new Error("should have failed"); }, (e) => e));

function playing(ids = "abc", index = 0) {
  usePlayer.setState({ queue: [...ids].map((id) => song(id)), index } as never);
}

beforeEach(() => {
  for (const f of [...Object.values(h.ytm), ...Object.values(h.library), h.settingsSet, h.findLyrics]) f.mockReset();
  for (const k of Object.keys(player())) if (typeof player()[k] === "function" && "mockReset" in (player()[k] as object)) player()[k].mockReset();
  usePlayer.setState({ queue: [], index: -1, shuffle: false, muted: false, repeat: "off", ratings: {} } as never);
  h.audio.duration = NaN;
  h.playbackTime.value = 0;
  h.lyrics.id = null;
  h.lyrics.status = "idle";
});

describe("player controls", () => {
  it("play, toggle, next and previous need something to play", async () => {
    for (const m of ["player.play", "player.toggle", "player.next", "player.previous", "player.seek"]) {
      expect(await fails(run(m, m === "player.seek" ? { positionMs: 1 } : {}))).toEqual({ name: "Unavailable", reason: "nothingPlaying" });
    }
    expect(await run("player.pause")).toEqual({});
    expect(player().setPlaying).not.toHaveBeenCalled();
  });

  it("maps controls to the player store", async () => {
    playing("abc", 0);
    await run("player.play");
    expect(player().setPlaying).toHaveBeenCalledWith(true);
    await run("player.pause");
    expect(player().setPlaying).toHaveBeenLastCalledWith(false);
    await run("player.toggle");
    expect(player().togglePlay).toHaveBeenCalled();
    await run("player.next");
    expect(player().next).toHaveBeenCalled();
    await run("player.previous");
    expect(player().prev).toHaveBeenCalled();
  });

  it("refuses next at the end of the queue", async () => {
    playing("ab", 1);
    expect(await fails(run("player.next"))).toEqual({ name: "Unavailable", reason: null });
    expect(player().next).not.toHaveBeenCalled();
  });

  it("seeks to a position or by an offset, clamped to the item", async () => {
    playing("a");
    h.audio.duration = 100;
    await run("player.seek", { positionMs: 30_000 });
    expect(player().seek).toHaveBeenLastCalledWith(30);
    h.playbackTime.value = 40;
    await run("player.seek", { offsetMs: -10_000 });
    expect(player().seek).toHaveBeenLastCalledWith(30);
    await run("player.seek", { positionMs: 500_000 });
    expect(player().seek).toHaveBeenLastCalledWith(100);
    await run("player.seek", { offsetMs: -999_000 });
    expect(player().seek).toHaveBeenLastCalledWith(0);
  });

  it("sets volume (0–100 → 0–1), mute, shuffle, repeat and episode speed", async () => {
    await run("player.setVolume", { volume: 55 });
    expect(player().setVolume).toHaveBeenCalledWith(0.55);
    await run("player.setVolume", { muted: true });
    expect(player().toggleMute).toHaveBeenCalledTimes(1);
    usePlayer.setState({ muted: true } as never);
    await run("player.setVolume", { muted: true });
    expect(player().toggleMute).toHaveBeenCalledTimes(1);
    await run("player.setShuffle", { enabled: true });
    expect(player().toggleShuffle).toHaveBeenCalledTimes(1);
    await run("player.setShuffle", { enabled: false });
    expect(player().toggleShuffle).toHaveBeenCalledTimes(1);
    await run("player.setRepeat", { mode: "one" });
    expect(usePlayer.getState().repeat).toBe("one");
    await run("player.setRate", { rate: 1.5 });
    expect(h.settingsSet).toHaveBeenCalledWith({ podcastSpeed: 1.5 });
  });
});

describe("player.playItem", () => {
  it("plays a track found through /next, at a position", async () => {
    h.ytm.getWatch.mockResolvedValue({ tracks: [song("x"), song("y")] });
    await run("player.playItem", { item: { type: "track", id: "y" }, positionMs: 12_000 });
    expect(player().playQueue).toHaveBeenCalledWith([expect.objectContaining({ id: "y" })], 0, {}, 12);
  });

  it("answers NotFound for a track YouTube does not know", async () => {
    h.ytm.getWatch.mockResolvedValue({ tracks: [] });
    expect(await fails(run("player.playItem", { item: { type: "track", id: "nope" } }))).toEqual({ name: "NotFound", reason: null });
    expect(player().playQueue).not.toHaveBeenCalled();
  });

  it("plays an album from a track in it, and rejects a start id that is not there", async () => {
    h.ytm.getAlbum.mockResolvedValue({ type: "album", id: "MPREb", title: "Album", subtitle: "", tracks: [song("a"), song("b"), song("c")], related: [] });
    await run("player.playItem", { item: { type: "album", id: "MPREb" }, startId: "c" });
    expect(player().playQueue).toHaveBeenCalledWith(expect.any(Array), 2, { title: "Album" }, undefined);
    expect(await fails(run("player.playItem", { item: { type: "album", id: "MPREb" }, startId: "zzz" }))).toEqual({ name: "InvalidParams", reason: null, path: "/startId" });
  });

  it("plays a playlist (all pages) with its id as the queue's source and turns shuffle on", async () => {
    const more = vi.fn().mockResolvedValue({ type: "playlist", id: "PL1", title: "List", subtitle: "", tracks: [song("c")], loadMore: null });
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "PL1", title: "List", subtitle: "", tracks: [song("a"), song("b")], loadMore: more });
    await run("player.playItem", { item: { type: "playlist", id: "PL1" }, shuffle: true });
    expect(player().toggleShuffle).toHaveBeenCalled();
    const [tracks, , context] = player().playQueue.mock.calls[0];
    expect(tracks.map((t: Track) => t.id)).toEqual(["a", "b", "c"]);
    expect(context).toEqual({ playlistId: "PL1", title: "List" });
  });

  it("plays a podcast's episodes with the show attached", async () => {
    h.ytm.getPodcastShow.mockResolvedValue({ title: "Show", episodes: [song("e1", { podcast: true })], next: null, chips: [], saved: false });
    await run("player.playItem", { item: { type: "podcast", id: "PLshow" } });
    expect(player().playQueue.mock.calls[0][0][0]).toMatchObject({ id: "e1", show: { id: "PLshow", title: "Show" } });
  });

  it("doesn't play or queue library lists for an app without library:read", async () => {
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "x", title: "List", subtitle: "", tracks: [song("a")], loadMore: null });
    h.ytm.getPlaylistEntries.mockResolvedValue({ ...page([song("a")]), own: null });
    const notFound = { name: "NotFound", reason: null };
    const control: Call["scopes"] = ["player:control", "player:read", "queue:read", "queue:write"];
    for (const id of ["LM", "VLLM", "SE", "VLSE"]) {
      const item = { type: "playlist", id };
      expect(await fails(run("player.playItem", { item }, control)), id).toEqual(notFound);
      expect(await fails(run("queue.add", { items: [item] }, control)), id).toEqual(notFound);
      expect(await fails(run("queue.playNext", { items: [item] }, control)), id).toEqual(notFound);
    }
    h.ytm.getPlaylistEntries.mockResolvedValue({ ...page([song("a")]), own: { privacy: "PRIVATE" } });
    expect(await fails(run("queue.add", { items: [{ type: "playlist", id: "PLmine" }] }, control))).toEqual(notFound);
    expect(player().playQueue).not.toHaveBeenCalled();
    expect(player().playNext).not.toHaveBeenCalled();
    // Someone else's public playlist plays; with library:read so does liked songs.
    h.ytm.getPlaylistEntries.mockResolvedValue({ ...page([song("a")]), own: null });
    await run("player.playItem", { item: { type: "playlist", id: "PLpub" } }, control);
    await run("player.playItem", { item: { type: "playlist", id: "VLLM" } });
    expect(player().playQueue.mock.calls.map((c) => c[2].playlistId)).toEqual(["PLpub", "LM"]);
  });

  it("says notPlayable for an album without tracks", async () => {
    h.ytm.getAlbum.mockResolvedValue({ type: "album", id: "x", title: "Empty", subtitle: "", tracks: [], related: [] });
    expect(await fails(run("player.playItem", { item: { type: "album", id: "x" } }))).toEqual({ name: "Unavailable", reason: "notPlayable" });
  });
});

describe("queue", () => {
  it("pages the queue and expires cursors when it changes", async () => {
    playing("abcde", 1);
    const first = await run("queue.get", { limit: 2 });
    expect(first).toMatchObject({ revision: 1, currentIndex: 1, length: 5, nextCursor: "q1.2" });
    expect(first.items.map((e: { entryId: string }) => e.entryId)).toEqual(["a", "b"]);
    expect((await run("queue.get", { cursor: first.nextCursor })).items).toHaveLength(3);
    expect((await run("queue.get", { fromIndex: 4 })).items.map((e: { index: number }) => e.index)).toEqual([4]);
    expect(await fails(run("queue.get", { cursor: "q0.2" }))).toMatchObject({ name: "InvalidParams", reason: "cursorExpired" });
  });

  it("adds items and reports how many arrived", async () => {
    playing("a");
    h.ytm.getWatch.mockResolvedValue({ tracks: [song("x")] });
    expect(await run("queue.add", { items: [{ type: "track", id: "x" }] })).toMatchObject({ added: 1, truncated: false, limit: 1000, queue: { length: 2 } });
    h.ytm.getWatch.mockResolvedValue({ tracks: [] });
    expect(await fails(run("queue.add", { items: [{ type: "track", id: "gone" }] }))).toEqual({ name: "NotFound", reason: null });
  });

  it("adds at most 1000 entries per call, looking up only the references it needs", async () => {
    playing("a");
    const big = (n: number) => ({ type: "playlist", id: "PL", title: "Big", subtitle: "", tracks: Array.from({ length: 100 }, (_, i) => song(`p${n}-${i}`)), loadMore: n < 4 ? () => Promise.resolve(big(n + 1)) : null });
    h.ytm.getPlaylist.mockImplementation(async () => big(0));
    const items = Array.from({ length: 50 }, (_, i) => ({ type: "playlist", id: `PL${i}` }));
    const r = await run("queue.add", { items });
    expect(r).toMatchObject({ added: 1000, truncated: true, limit: 1000 });
    expect(h.ytm.getPlaylist.mock.calls.length).toBeLessThan(10);
  });

  it("never grows the queue past 5000 entries", async () => {
    usePlayer.setState({ queue: Array.from({ length: 4990 }, (_, i) => song(`q${i}`)), index: 0 } as never);
    h.ytm.getAlbum.mockResolvedValue({ type: "album", id: "MPREb", title: "Album", subtitle: "", tracks: Array.from({ length: 20 }, (_, i) => song(`t${i}`)), related: [] });
    expect(await run("queue.add", { items: [{ type: "album", id: "MPREb" }] })).toMatchObject({ added: 10, truncated: true, limit: 10 });
    expect(await run("queue.add", { items: [{ type: "album", id: "MPREb" }] })).toMatchObject({ added: 0, truncated: true, limit: 0 });
    expect(await run("queue.playNext", { items: [{ type: "album", id: "MPREb" }] })).toMatchObject({ added: 0, truncated: true, limit: 0 });
  });

  it("calls an add truncated when one album or playlist had more than 500 items", async () => {
    playing("a");
    const tracks = (n: number) => Array.from({ length: n }, (_, i) => song(`t${i}`));
    h.ytm.getAlbum.mockResolvedValue({ type: "album", id: "MPREb", title: "Album", subtitle: "", tracks: tracks(501), related: [] });
    expect(await run("queue.add", { items: [{ type: "album", id: "MPREb" }] })).toMatchObject({ added: 500, truncated: true, limit: 1000 });
    h.ytm.getAlbum.mockResolvedValue({ type: "album", id: "MPREb", title: "Album", subtitle: "", tracks: tracks(500), related: [] });
    expect(await run("queue.add", { items: [{ type: "album", id: "MPREb" }] })).toMatchObject({ added: 500, truncated: false });
  });

  it("doesn't call an add truncated when everything just fits", async () => {
    usePlayer.setState({ queue: Array.from({ length: 4980 }, (_, i) => song(`q${i}`)), index: 0 } as never);
    h.ytm.getAlbum.mockResolvedValue({ type: "album", id: "MPREb", title: "Album", subtitle: "", tracks: Array.from({ length: 20 }, (_, i) => song(`t${i}`)), related: [] });
    expect(await run("queue.add", { items: [{ type: "album", id: "MPREb" }] })).toMatchObject({ added: 20, truncated: false, limit: 20 });
  });

  it("looks references up a few at a time", async () => {
    playing("a");
    let open = 0;
    let most = 0;
    h.ytm.getWatch.mockImplementation(async ({ videoId }: { videoId: string }) => {
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 1));
      open--;
      return { tracks: [song(videoId)] };
    });
    const items = Array.from({ length: 50 }, (_, i) => ({ type: "track", id: `t${i}` }));
    const r = await run("queue.add", { items });
    expect(r.added).toBe(50);
    expect(player().queue.slice(1).map((t) => t.id)).toEqual(items.map((i) => i.id));
    expect(most).toBeLessThanOrEqual(4);
  });

  it("stops a cancelled call between YouTube requests and changes nothing", async () => {
    const stop = new AbortController();
    const more = vi.fn(async () => {
      stop.abort();
      return { type: "playlist", id: "PL1", title: "L", subtitle: "", tracks: [song("b")], loadMore: async () => ({ type: "playlist", id: "PL1", title: "L", subtitle: "", tracks: [song("c")], loadMore: null }) };
    });
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "PL1", title: "L", subtitle: "", tracks: [song("a")], loadMore: more });
    await expect(dispatch("queue.add", { items: [{ type: "playlist", id: "PL1" }] }, { ...call(), signal: stop.signal })).rejects.toThrow();
    await expect(dispatch("player.playItem", { item: { type: "playlist", id: "PL1" } }, { ...call(), signal: stop.signal })).rejects.toThrow();
    expect(more).toHaveBeenCalledTimes(1);
    expect(player().queue).toEqual([]);
    expect(player().playQueue).not.toHaveBeenCalled();
  });

  it("plays next, moves, clears and sets autoplay", async () => {
    playing("abc", 0);
    h.ytm.getWatch.mockResolvedValue({ tracks: [song("x")] });
    await run("queue.playNext", { items: [{ type: "track", id: "x" }] });
    expect(player().playNext).toHaveBeenCalledWith([expect.objectContaining({ id: "x" })]);
    await run("queue.move", { entryId: "c", toIndex: 99 });
    expect(player().moveTrack).toHaveBeenCalledWith(2, 2);
    expect(await fails(run("queue.move", { entryId: "zz", toIndex: 0 }))).toEqual({ name: "NotFound", reason: null });
    await run("queue.clear");
    expect(player().clearQueue).toHaveBeenCalled();
    await run("queue.setAutoplay", { enabled: false });
    expect(player().setAutoplay).toHaveBeenCalledWith(false);
  });

  it("removes entries; the playing one gives way to the next", async () => {
    playing("abc", 1);
    const r = await run("queue.remove", { entryIds: ["c", "nope"] });
    expect(r.removed).toBe(1);
    expect(usePlayer.getState().queue.map((t) => t.id).join("")).toBe("ab");
    await run("queue.remove", { entryIds: ["b"] });
    // Nothing after it: what is left stays, stopped.
    expect(usePlayer.getState().queue.map((t) => t.id).join("")).toBe("a");
    expect(usePlayer.getState().status).toBe("idle");
    playing("abc", 0);
    await run("queue.remove", { entryIds: ["a"] });
    expect(player().playIndex).toHaveBeenCalledWith(1);
  });
});

describe("library and playlists", () => {
  it("lists library items through pages and cursors", async () => {
    const lists = [{ type: "album", id: "A1", title: "One", subtitle: "Album • 2020" }, { type: "album", id: "A2", title: "Two", subtitle: "Single • 2021" }] as Item[];
    h.ytm.getLibrary.mockResolvedValue(page(lists.slice(0, 1), async () => page(lists.slice(1))));
    const first = await run("library.albums", { limit: 1 });
    expect(h.ytm.getLibrary).toHaveBeenCalledWith("albums");
    expect(first.items).toMatchObject([{ type: "album", id: "A1", year: 2020 }]);
    const second = await run("library.albums", { cursor: first.nextCursor, limit: 1 });
    expect(second).toMatchObject({ items: [{ id: "A2", albumType: "single" }], nextCursor: null });
  });

  it("maps each library list to its section", async () => {
    h.ytm.getLibrary.mockResolvedValue(page([]));
    for (const [m, section] of [["library.playlists", "playlists"], ["library.likedSongs", "liked"], ["library.artists", "artists"], ["library.podcasts", "podcasts"], ["library.episodesForLater", "episodes"]]) {
      await run(m);
      expect(h.ytm.getLibrary).toHaveBeenLastCalledWith(section);
    }
  });

  it("passes NotSignedIn through", async () => {
    h.ytm.getLibrary.mockRejectedValue(new FakeAuthError());
    expect(await fails(run("library.playlists"))).toEqual({ name: "NotSignedIn", reason: null });
  });

  it("flattens history shelves with their day", async () => {
    h.ytm.getHistory.mockResolvedValue(page([{ title: "Today", items: [song("a")] }, { title: "Yesterday", items: [song("b")] }]));
    const r = await run("library.history");
    expect(r.items.map((e: { sectionText: string }) => e.sectionText)).toEqual(["Today", "Yesterday"]);
  });

  it("hides the user's own playlists from apps with only search", async () => {
    h.ytm.getPlaylistEntries.mockResolvedValue({ ...page([song("a")]), own: { privacy: "PUBLIC" } });
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "PLmine", title: "Mine", subtitle: "3 tracks", tracks: [song("a")], loadMore: null });
    expect(await fails(run("playlist.get", { id: "PLmine" }, ["search"]))).toEqual({ name: "NotFound", reason: null });
    expect(await fails(run("playlist.get", { id: "LM" }, ["search"]))).toEqual({ name: "NotFound", reason: null });
    h.ytm.getPlaylistEntries.mockResolvedValue({ ...page([song("a")]), own: null });
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "PLpub", title: "Public", subtitle: "Someone • 1 tracks", tracks: [song("a")], loadMore: null });
    expect((await run("playlist.get", { id: "PLpub" }, ["search"])).playlist).toMatchObject({ id: "PLpub", editable: false });
    const mine = await run("playlist.get", { id: "PLmine" });
    expect(mine.playlist).toMatchObject({ title: "Public" });
  });

  it("keeps library lists from apps without library:read, whatever form the id takes", async () => {
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "x", title: "T", subtitle: "", tracks: [song("a")], loadMore: null });
    h.ytm.getPlaylistEntries.mockResolvedValue({ ...page([song("a")]), own: null });
    for (const id of ["LM", "VLLM", "VLVLLM", "SE", "VLSE", "LL", "RDPN", "RDTMAK5uy_mix"]) {
      expect(await fails(run("playlist.get", { id }, ["search"])), id).toEqual({ name: "NotFound", reason: null });
    }
    expect(h.ytm.getPlaylistEntries).not.toHaveBeenCalled();
    // Own and private playlists are recognised from YouTube's page, not from the (maybe unloaded) library store.
    h.ytm.getPlaylistEntries.mockResolvedValue({ ...page([song("a")]), own: { privacy: "PUBLIC" } });
    for (const id of ["PLown", "VLPLown"]) expect(await fails(run("playlist.get", { id }, ["search"])), id).toEqual({ name: "NotFound", reason: null });
    h.ytm.getPlaylistEntries.mockResolvedValue({ ...page([song("a")]), own: { privacy: "PRIVATE" } });
    expect(await fails(run("playlist.get", { id: "PLprivate" }, ["search"]))).toEqual({ name: "NotFound", reason: null });
    // With library:read they are readable, under the plain id.
    expect((await run("playlist.get", { id: "VLLM", limit: 1 })).items).toHaveLength(1);
    expect(h.ytm.getPlaylist).toHaveBeenLastCalledWith("LM");
    expect(h.ytm.getPlaylistEntries).toHaveBeenLastCalledWith("LM");
  });

  it("doesn't let a cursor from a library call continue for an app without library:read", async () => {
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "PL1", title: "L", subtitle: "", tracks: [], loadMore: null });
    h.ytm.getPlaylistEntries.mockResolvedValue({ ...page([song("a")], async () => page([song("b")])), own: { privacy: "PRIVATE" } });
    const first = await run("playlist.get", { id: "PL1", limit: 1 });
    expect(await fails(run("playlist.get", { id: "PL1", limit: 1, cursor: first.nextCursor }, ["search"]))).toMatchObject({ name: "InvalidParams", reason: "cursorExpired" });
  });

  it("answers NotFound for a playlist YouTube returns empty", async () => {
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "x", title: "", subtitle: "", tracks: [], loadMore: null });
    expect(await fails(run("playlist.get", { id: "x" }))).toEqual({ name: "NotFound", reason: null });
  });

  it("creates, renames and deletes through the library store", async () => {
    h.ytm.getWatch.mockResolvedValue({ tracks: [song("a")] });
    h.library.create.mockResolvedValue("PLnew");
    expect(await run("playlist.create", { title: "T", privacy: "private", items: [{ type: "track", id: "a" }] })).toMatchObject({ id: "PLnew", editable: true, trackCount: 1 });
    expect(h.library.create).toHaveBeenCalledWith("T", { description: undefined, privacy: "private", videoIds: ["a"] });
    await run("playlist.rename", { id: "PL1", title: "New" });
    expect(h.library.rename).toHaveBeenCalledWith("PL1", "New");
    await run("playlist.delete", { id: "PL1" });
    expect(h.library.remove).toHaveBeenCalledWith("PL1");
  });

  it("turns YouTube's refusal to edit someone else's playlist into notEditable", async () => {
    h.library.rename.mockRejectedValue(new Error("This playlist cannot be edited."));
    expect(await fails(run("playlist.rename", { id: "PLtheirs", title: "x" }))).toEqual({ name: "Unavailable", reason: "notEditable" });
    h.library.remove.mockRejectedValue(new FakeAuthError());
    expect(await fails(run("playlist.delete", { id: "PL1" }))).toEqual({ name: "NotSignedIn", reason: null });
  });

  it("adds only tracks the playlist lacks unless duplicates are allowed", async () => {
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "PL1", title: "L", subtitle: "", tracks: [song("a")], loadMore: null });
    const items = [{ type: "track", id: "a" }, { type: "track", id: "b" }, { type: "track", id: "b" }];
    expect(await run("playlist.addTracks", { id: "PL1", items })).toEqual({ added: 1, skipped: 2 });
    expect(h.ytm.addToPlaylist).toHaveBeenCalledWith("PL1", ["b"]);
    expect(h.library.adjustCount).toHaveBeenCalledWith("PL1", 1);
    h.ytm.addToPlaylist.mockClear();
    expect(await run("playlist.addTracks", { id: "PL1", items, allowDuplicates: true })).toEqual({ added: 3, skipped: 0 });
    expect(h.ytm.addToPlaylist).toHaveBeenCalledWith("PL1", ["a", "b", "b"]);
  });

  it("lists entries with their own ids: the same song twice has two", async () => {
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "PL1", title: "L", subtitle: "3 tracks", tracks: [song("a"), song("b"), song("a")], loadMore: null });
    h.ytm.getPlaylistEntries.mockResolvedValue(page([song("a", { setVideoId: "S1" }), song("b", { setVideoId: "S2" }), song("a", { setVideoId: "S3" })]));
    const r = await run("playlist.get", { id: "PL1" });
    expect(r.items.map((e: { entryId: string; item: { id: string } }) => [e.entryId, e.item.id])).toEqual([["S1", "a"], ["S2", "b"], ["S3", "a"]]);
    // A playlist whose entries carry no ids (nothing to edit with).
    h.ytm.getPlaylistEntries.mockResolvedValue(page([song("a")]));
    expect((await run("playlist.get", { id: "PL1" })).items[0].entryId).toBeNull();
  });

  it("pages entries across YouTube's pages", async () => {
    h.ytm.getPlaylist.mockResolvedValue({ type: "playlist", id: "PL1", title: "L", subtitle: "", tracks: [], loadMore: null });
    h.ytm.getPlaylistEntries.mockResolvedValue(page([song("a", { setVideoId: "S1" })], async () => page([song("b", { setVideoId: "S2" })])));
    const first = await run("playlist.get", { id: "PL1", limit: 1 });
    expect(first.items.map((e: { entryId: string }) => e.entryId)).toEqual(["S1"]);
    const second = await run("playlist.get", { id: "PL1", limit: 1, cursor: first.nextCursor });
    expect(second.items.map((e: { entryId: string }) => e.entryId)).toEqual(["S2"]);
    expect(second.nextCursor).toBeNull();
  });

  it("removes exactly the entries asked for, one copy of a duplicated song at a time", async () => {
    h.ytm.getPlaylistEntries.mockResolvedValue(page([song("a", { setVideoId: "S1" }), song("b", { setVideoId: "S2" }), song("a", { setVideoId: "S3" })]));
    expect(await run("playlist.removeTracks", { id: "PL1", entryIds: ["S3"] })).toEqual({ removed: 1 });
    expect(h.ytm.removeFromPlaylist).toHaveBeenCalledWith("PL1", ["S3"], true);
    expect(h.library.adjustCount).toHaveBeenCalledWith("PL1", -1);
    // Several at once, ids the playlist doesn't have are ignored and not counted.
    h.ytm.removeFromPlaylist.mockClear();
    expect(await run("playlist.removeTracks", { id: "PL1", entryIds: ["S1", "S2", "nope"] })).toEqual({ removed: 2 });
    expect(h.ytm.removeFromPlaylist).toHaveBeenCalledWith("PL1", ["S1", "S2"], true);
    // A video id is not an entry id.
    h.ytm.removeFromPlaylist.mockClear();
    expect(await run("playlist.removeTracks", { id: "PL1", entryIds: ["a"] })).toEqual({ removed: 0 });
    expect(h.ytm.removeFromPlaylist).not.toHaveBeenCalled();
  });

  it("finds entries on later pages and refuses someone else's playlist", async () => {
    h.ytm.getPlaylistEntries.mockResolvedValue(page([song("a", { setVideoId: "S1" })], async () => page([song("b", { setVideoId: "S2" })])));
    expect(await run("playlist.removeTracks", { id: "PL1", entryIds: ["S2"] })).toEqual({ removed: 1 });
    h.ytm.removeFromPlaylist.mockRejectedValue(new Error("This playlist cannot be edited."));
    expect(await fails(run("playlist.removeTracks", { id: "PLx", entryIds: ["S1"] }))).toEqual({ name: "Unavailable", reason: "notEditable" });
    h.ytm.getPlaylistEntries.mockRejectedValue(new Error("Request failed with status code 404"));
    expect(await fails(run("playlist.removeTracks", { id: "PLgone", entryIds: ["S1"] }))).toEqual({ name: "NotFound", reason: null });
  });
});

describe("search and browse", () => {
  it("searches everything: top result and one page of items", async () => {
    h.ytm.search.mockResolvedValue({
      top: [{ type: "artist", id: "UC1", title: "Radiohead", subtitle: "" }], topActions: [], shelves: [], chips: [], messages: [], next: null,
      groups: [{ id: "songs", items: [song("a")] }],
    });
    const r = await run("search.query", { query: "radiohead" });
    expect(h.ytm.search).toHaveBeenCalledWith("radiohead");
    expect(r).toMatchObject({ topResult: { type: "artist", name: "Radiohead" }, items: [{ type: "track", id: "a" }], nextCursor: null });
  });

  it("searches one type, paged, and keeps only that type", async () => {
    const result = (items: Item[], next: string | null) => ({ top: [], topActions: [], shelves: [], chips: [], messages: [], groups: [{ id: "songs", items }], next });
    h.ytm.searchByType.mockImplementation(async (_q: string, _t: string, next?: string) => (next ? result([song("c") as Item], null) : result([song("a") as Item, { type: "album", id: "A", title: "x", subtitle: "" } as Item], "n1")));
    const first = await run("search.query", { query: "q", type: "songs", limit: 1 });
    expect(h.ytm.searchByType).toHaveBeenCalledWith("q", "songs", undefined);
    expect(first.items.map((i: { id: string }) => i.id)).toEqual(["a"]);
    const second = await run("search.query", { query: "q", type: "songs", limit: 5, cursor: first.nextCursor });
    expect(second.items.map((i: { id: string }) => i.id)).toEqual(["c"]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns suggestions", async () => {
    h.ytm.getSearchSuggestions.mockResolvedValue({ queries: ["radiohead", "radio"], items: [] });
    expect(await run("search.suggestions", { query: "radio" })).toEqual({ queries: ["radiohead", "radio"], items: [] });
  });

  it("builds album, artist, podcast and episode pages, or says NotFound", async () => {
    h.ytm.getAlbum.mockResolvedValue({ type: "album", id: "A", title: "Album", subtitle: "Album • 2000", tracks: [song("a")], related: [] });
    expect(await run("browse.album", { id: "A" })).toMatchObject({ title: "Album", trackCount: 1 });
    h.ytm.getAlbum.mockResolvedValue({ type: "album", id: "A", title: "", subtitle: "", tracks: [], related: [] });
    expect(await fails(run("browse.album", { id: "A" }))).toEqual({ name: "NotFound", reason: null });
    h.ytm.getArtist.mockResolvedValue({ type: "artist", id: "UC", title: "Artist", subtitle: "", shelves: [] });
    expect(await run("browse.artist", { id: "UC" })).toMatchObject({ name: "Artist", sections: [] });
    h.ytm.getArtist.mockRejectedValue(new Error("Request failed with status code 404"));
    expect(await fails(run("browse.artist", { id: "UC" }))).toEqual({ name: "NotFound", reason: null });
    h.ytm.getPodcastShow.mockResolvedValue({ title: "Show", channel: { id: "UC", name: "Host" }, episodes: [song("e", { podcast: true })], next: null, chips: [], saved: false });
    expect(await run("browse.podcast", { id: "PL" })).toMatchObject({ podcast: { title: "Show", author: "Host" }, items: [{ type: "episode", id: "e" }] });
    h.ytm.getEpisode.mockResolvedValue(song("e", { podcast: true, episode: { description: "Notes" } }));
    expect(await run("browse.episode", { id: "e" })).toMatchObject({ type: "episode", description: "Notes" });
    h.ytm.getEpisode.mockResolvedValue(null);
    expect(await fails(run("browse.episode", { id: "zz" }))).toEqual({ name: "NotFound", reason: null });
  });
});

describe("rating.set", () => {
  it("rates tracks, remembers it and skips a disliked playing song", async () => {
    playing("ab", 0);
    await run("rating.set", { item: { type: "track", id: "a" }, rating: "like" });
    expect(h.ytm.rate).toHaveBeenCalledWith("a", "LIKE");
    expect(usePlayer.getState().ratings).toMatchObject({ a: "LIKE" });
    await run("rating.set", { item: { type: "track", id: "a" }, rating: "dislike" });
    expect(h.ytm.rate).toHaveBeenLastCalledWith("a", "DISLIKE");
    expect(player().next).toHaveBeenCalled();
    await run("rating.set", { item: { type: "episode", id: "b" }, rating: "none" });
    expect(h.ytm.rate).toHaveBeenLastCalledWith("b", "INDIFFERENT");
  });

  it("saves and unsaves albums, playlists and podcasts; dislike is invalid for them", async () => {
    await run("rating.set", { item: { type: "album", id: "MPREb" }, rating: "like" });
    expect(h.ytm.setSaved).toHaveBeenCalledWith({ type: "album", id: "MPREb" }, true);
    await run("rating.set", { item: { type: "playlist", id: "PL" }, rating: "none" });
    expect(h.ytm.setSaved).toHaveBeenLastCalledWith({ type: "playlist", id: "PL" }, false);
    await run("rating.set", { item: { type: "podcast", id: "PLp" }, rating: "like" });
    expect(h.ytm.setPodcastSaved).toHaveBeenCalledWith("PLp", true);
    expect(await fails(run("rating.set", { item: { type: "album", id: "x" }, rating: "dislike" }))).toEqual({ name: "InvalidParams", reason: null, path: "/rating" });
  });

  it("passes NotSignedIn and unknown ids through", async () => {
    h.ytm.rate.mockRejectedValue(new FakeAuthError());
    expect(await fails(run("rating.set", { item: { type: "track", id: "a" }, rating: "like" }))).toEqual({ name: "NotSignedIn", reason: null });
    h.ytm.rate.mockRejectedValue(new Error("Request failed with status code 404"));
    expect(await fails(run("rating.set", { item: { type: "track", id: "a" }, rating: "like" }))).toEqual({ name: "NotFound", reason: null });
  });
});

describe("lyrics.get", () => {
  const found = { provider: "lrclib", synced: true, lines: [{ start: 1000, text: "Hi" }] };

  it("needs a track when nothing plays", async () => {
    expect(await fails(run("lyrics.get"))).toEqual({ name: "Unavailable", reason: "nothingPlaying" });
  });

  it("returns what the lyrics store already has for the playing track", async () => {
    playing("a");
    h.lyrics.id = "a";
    h.lyrics.status = "done";
    h.lyrics.data = found;
    expect(await run("lyrics.get")).toMatchObject({ trackId: "a", status: "found", lyrics: { tier: "line", provider: "lrclib" } });
    expect(h.findLyrics).not.toHaveBeenCalled();
  });

  it("looks up the playing track when the store has not, and any other track by id", async () => {
    playing("a");
    h.findLyrics.mockResolvedValue(null);
    expect(await run("lyrics.get")).toEqual({ trackId: "a", status: "notFound", lyrics: null });
    h.ytm.getWatch.mockResolvedValue({ tracks: [song("z")] });
    h.findLyrics.mockResolvedValue(found);
    expect(await run("lyrics.get", { trackId: "z" })).toMatchObject({ trackId: "z", status: "found" });
    expect(h.findLyrics).toHaveBeenLastCalledWith(expect.objectContaining({ id: "z" }));
  });

  it("has no lyrics for episodes", async () => {
    usePlayer.setState({ queue: [song("e", { podcast: true })], index: 0 } as never);
    expect(await run("lyrics.get")).toEqual({ trackId: "e", status: "notFound", lyrics: null });
    expect(h.findLyrics).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it("answers MethodNotFound for methods it does not have", async () => {
    expect(await fails(run("player.fly"))).toEqual({ name: "MethodNotFound", reason: null });
  });

  it("passes ApiErrors through with their extra members (PermissionDenied keeps its scope)", () => {
    expect(bridgeError(new ApiError("PermissionDenied", null, { scope: "library:read" }))).toEqual({ name: "PermissionDenied", reason: null, scope: "library:read" });
    expect(bridgeError(new ApiError("RateLimited", "x", { retryAfterMs: 5 }))).toEqual({ name: "RateLimited", reason: "x", retryAfterMs: 5 });
  });

  it("maps sign-in, network and unknown failures", () => {
    expect(bridgeError(new FakeAuthError())).toEqual({ name: "NotSignedIn", reason: null });
    expect(bridgeError(new Error("error sending request for url (https://music.youtube.com)"))).toEqual({ name: "Timeout", reason: null });
    expect(bridgeError(new Error("boom"))).toEqual({ name: "InternalError", reason: null });
    expect(bridgeError(new Error("Request failed with status code 404"))).toEqual({ name: "InternalError", reason: null });
    expect(bridgeError(new Error("Request failed with status code 404"), { missing: true })).toEqual({ name: "NotFound", reason: null });
  });
});
