import { describe, expect, it } from "vitest";
import type { Album, Artist, Item, Track } from "../api/types";
import { album, albumDetail, artistDetail, episode, item, lyricsResult, playlist, thumb, track, type Ctx } from "./convert";

const lib: Ctx = { library: true };
const anon: Ctx = { library: false };

const song: Track = {
  type: "track", id: "9RfVp-GhKfs", title: "Creep", subtitle: "Radiohead • Creep • 3:59", artists: ["Radiohead"], artistIds: ["UCr"],
  album: { id: "MPREb_x", title: "Creep" }, durationSec: 239, thumbnail: "https://yt3.googleusercontent.com/abc=w240-h240-l90-rj", rating: "LIKE",
};

describe("tracks and episodes", () => {
  it("maps a song with credits, length and big artwork", () => {
    expect(track(song, lib)).toEqual({
      type: "track", id: "9RfVp-GhKfs", title: "Creep", artists: [{ id: "UCr", name: "Radiohead" }], album: { id: "MPREb_x", title: "Creep" },
      durationMs: 239000, thumbnailUrl: "https://yt3.googleusercontent.com/abc=w1200-h1200-l90-rj", explicit: false, video: false, rating: "like",
    });
  });

  it("hides ratings without library:read and prefers this session's rating", () => {
    expect(track(song, anon).rating).toBeNull();
    expect(track(song, { library: true, rating: () => "DISLIKE" }).rating).toBe("dislike");
    expect(track({ ...song, rating: undefined }, lib).rating).toBe("none");
  });

  it("drops label words parsed as artists (search top results)", () => {
    const top = { ...song, artists: ["Song"], artistIds: undefined, kind: "Song" } as Track & Item;
    expect(track(top, lib).artists).toEqual([]);
  });

  it("maps an episode with its show and progress", () => {
    const ep: Track = {
      type: "track", id: "ep1", title: "Sleep", subtitle: "Dec 5, 2024 • Huberman Lab", artists: [], podcast: true, durationSec: 1800,
      show: { id: "PLx", title: "Huberman Lab" }, episode: { published: "Dec 5, 2024", progress: { percent: 50, played: false } },
    };
    expect(episode(ep, lib)).toMatchObject({ type: "episode", podcast: { id: "PLx", title: "Huberman Lab" }, author: "Huberman Lab", publishedText: "Dec 5, 2024", played: false, resumePositionMs: 900000 });
    expect(episode(ep, { library: true, episode: () => ({ played: true, resumeSec: 0 }) })).toMatchObject({ played: true, resumePositionMs: 0 });
    expect(episode(ep, anon)).toMatchObject({ played: null, resumePositionMs: null });
    expect(item(ep as Item, lib)?.type).toBe("episode");
  });
});

describe("collections", () => {
  it("reads album type, artists and year from the subtitle", () => {
    expect(album({ id: "MPREb", title: "radiohead", subtitle: "Single • Nightly • 2023", kind: "Single" })).toMatchObject({ albumType: "single", year: 2023, artists: [{ id: null, name: "Nightly" }] });
  });

  it("tells own playlists from saved and automatic ones", () => {
    expect(playlist({ id: "PL1", title: "Mine", subtitle: "7 tracks" })).toMatchObject({ trackCount: 7, author: null, editable: true });
    expect(playlist({ id: "PL2", title: "Theirs", subtitle: "Someone • 1,204 tracks" })).toMatchObject({ trackCount: 1204, author: "Someone", editable: false });
    expect(playlist({ id: "LM", title: "Liked Music", subtitle: "Auto playlist" }).editable).toBe(false);
  });

  it("maps podcasts and leaves user channels out", () => {
    const show = { type: "playlist", id: "PLx", title: "Huberman Lab", subtitle: "Podcast • Andrew Huberman", podcast: true } as Item;
    expect(item(show, lib)).toEqual({ type: "podcast", id: "PLx", title: "Huberman Lab", author: "Andrew Huberman", thumbnailUrl: null });
    expect(item({ type: "artist", id: "UC1", title: "Someone", subtitle: "", channel: true } as Item, lib)).toBeNull();
  });

  it("builds album and artist pages", () => {
    const a: Album = { type: "album", id: "MPREb", title: "OK Computer", subtitle: "Album • 1997", tracks: [{ ...song, explicit: true }, song], related: [] };
    expect(albumDetail(a, lib)).toMatchObject({ artists: [{ id: "UCr", name: "Radiohead" }], year: 1997, albumType: "album", trackCount: 2, durationMs: 478000, explicit: true });
    const ar: Artist = {
      type: "artist", id: "UCr", title: "Radiohead", subtitle: "", shelves: [
        { title: "Top songs", items: [song as Item] },
        { title: "Videos", items: [song as Item] },
        { title: "Fans might also like", items: [{ type: "artist", id: "UCm", title: "Muse", subtitle: "1M subscribers" }] },
      ],
    };
    const d = artistDetail(ar, lib);
    expect(d.sections.map((s) => s.kind)).toEqual(["songs", "videos", "related"]);
    expect(d.sections[1].items[0]).toMatchObject({ video: true });
    expect(d.sections[2].items[0]).toMatchObject({ type: "artist", subscribersText: "1M subscribers" });
  });
});

describe("artwork and lyrics", () => {
  it("only hands out absolute https artwork", () => {
    expect(thumb("//i.ytimg.com/vi/x/hqdefault.jpg")).toBe("https://i.ytimg.com/vi/x/hqdefault.jpg");
    expect(thumb("http://example.com/a.jpg")).toBeNull();
    expect(thumb(undefined)).toBeNull();
  });

  it("maps word-synced, line-synced and plain lyrics", () => {
    const words = lyricsResult("t", {
      provider: "lrclib", synced: true, source: "Musixmatch",
      lines: [{ start: 1000, end: 2000, text: "Hi there", words: [{ start: 1000, end: 1500, text: "Hi " }, { start: 1500, end: 2000, text: "there" }] }],
    });
    expect(words).toMatchObject({ status: "found", lyrics: { tier: "word", providerName: "LRCLIB", attribution: "Musixmatch" } });
    expect(words.lyrics!.lines[0].words).toHaveLength(2);
    const lines = lyricsResult("t", { provider: "kugou", synced: true, lines: [{ start: 5, text: "a" }] });
    expect(lines.lyrics).toMatchObject({ tier: "line", lines: [{ startMs: 5, endMs: null, words: [], background: [] }] });
    const plain = lyricsResult("t", { provider: "youtube", synced: false, lines: [], plain: "one\ntwo" });
    expect(plain.lyrics).toMatchObject({ tier: "unsynced", lines: [{ text: "one", startMs: null }, { text: "two" }] });
    expect(lyricsResult("t", null)).toEqual({ trackId: "t", status: "notFound", lyrics: null });
  });
});
