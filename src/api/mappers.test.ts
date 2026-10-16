import { describe, expect, it } from "vitest";
import {
  mapAlbum, mapArtist, mapItem, mapShelves, pickThumb, text,
} from "./mappers";

const thumbs = [
  { url: "small.jpg", width: 60 },
  { url: "mid.jpg", width: 226 },
  { url: "big.jpg", width: 544 },
];

const song = {
  type: "MusicResponsiveListItem",
  item_type: "song",
  id: "vid1",
  title: "Song One",
  artists: [{ name: "Artist A" }, { name: "Artist B" }],
  album: { id: "MPREb_1", name: "Album X" },
  duration: { text: "3:05", seconds: 185 },
  thumbnail: { contents: thumbs },
};

const twoRow = (item_type: string, extra: object = {}) => ({
  type: "MusicTwoRowItem",
  item_type,
  id: "MPREb_abc",
  title: { text: "Title" },
  subtitle: { runs: [{ text: "Album" }, { text: " • " }, { text: "Someone" }] },
  thumbnail: thumbs,
  ...extra,
});

describe("text / pickThumb", () => {
  it("handles strings, text, runs and garbage", () => {
    expect(text("a")).toBe("a");
    expect(text({ text: "b" })).toBe("b");
    expect(text({ runs: [{ text: "c" }, { text: "d" }] })).toBe("cd");
    expect(text(undefined)).toBe("");
  });

  it("prefers first thumb >= 200px, falls back to last", () => {
    expect(pickThumb(thumbs)).toBe("mid.jpg");
    expect(pickThumb({ contents: [{ url: "x.jpg", width: 50 }] })).toBe("x.jpg");
    expect(pickThumb(undefined)).toBeUndefined();
  });
});

describe("mapItem", () => {
  it("maps a song list item", () => {
    expect(mapItem(song)).toEqual({
      type: "track",
      id: "vid1",
      title: "Song One",
      subtitle: "Artist A, Artist B • Album X",
      thumbnail: "mid.jpg",
      artists: ["Artist A", "Artist B"],
      album: { id: "MPREb_1", title: "Album X" },
      durationSec: 185,
      rating: undefined,
    });
  });

  it("reads like status from menu buttons", () => {
    const withMenu = (like_status: string) => ({ ...song, menu: { top_level_buttons: [{ type: "LikeButton", like_status }] } });
    expect(mapItem(withMenu("LIKE"))).toMatchObject({ rating: "LIKE" });
    expect(mapItem(withMenu("INDIFFERENT"))).toMatchObject({ rating: "INDIFFERENT" });
  });

  it("maps two-row album/artist and strips VL from playlists", () => {
    expect(mapItem(twoRow("album"))).toMatchObject({ type: "album", id: "MPREb_abc", title: "Title" });
    expect(mapItem(twoRow("artist"))).toMatchObject({ type: "artist" });
    expect(mapItem(twoRow("playlist", { id: "VLPL123" }))).toMatchObject({ type: "playlist", id: "PL123" });
  });

  it("maps radio 'endpoint' items by playlistId and skips ones without", () => {
    const radio = twoRow("endpoint", { id: undefined, endpoint: { payload: { playlistId: "RDAMVM1" } } });
    expect(mapItem(radio)).toMatchObject({ type: "playlist", id: "RDAMVM1" });
    expect(mapItem(twoRow("endpoint", { id: undefined }))).toBeNull();
  });

  it("returns null for unknown node types, missing ids, and malformed input", () => {
    expect(mapItem({ type: "SomethingNew" })).toBeNull();
    expect(mapItem({ ...song, id: undefined })).toBeNull();
    expect(mapItem(null)).toBeNull();
    expect(mapItem({ type: "MusicTwoRowItem", item_type: "album", get title(): never { throw new Error("x"); } })).toBeNull();
  });
});

describe("mapShelves", () => {
  it("maps carousels/grids, skips unknown shelves and empty ones", () => {
    const shelves = mapShelves([
      { type: "MusicCarouselShelf", header: { title: { text: "Quick picks" } }, contents: [song, { type: "Weird" }] },
      { type: "MusicTastebuilderShelf" },
      { type: "MusicCarouselShelf", header: { title: { text: "Empty" } }, contents: [] },
      { type: "Grid", items: [twoRow("playlist", { id: "VLPL9" })] },
    ]);
    expect(shelves.map((s) => [s.title, s.items.length])).toEqual([["Quick picks", 1], ["", 1]]);
  });
});

describe("pages", () => {
  it("maps album tracks with header fallbacks", () => {
    const album = mapAlbum("MPREb_1", {
      header: { title: { text: "Album X" }, subtitle: { text: "Album • Artist A • 2020" }, thumbnails: thumbs },
      contents: [{ type: "MusicResponsiveListItem", item_type: "song", id: "v2", title: "Track 2" }, { type: "ContinuationItem" }],
      sections: [],
    });
    expect(album.title).toBe("Album X");
    expect(album.tracks).toEqual([
      expect.objectContaining({ id: "v2", thumbnail: "mid.jpg", artists: ["Artist A"] }),
    ]);
  });

  it("takes an album's artists from the strapline, with their ids, never the year", () => {
    const album = mapAlbum("MPREb_2", {
      header: {
        title: { text: "Album Y" },
        subtitle: { text: "Album • 2019" },
        strapline_text_one: { text: "Artist A & Artist B", runs: [
          { text: "Artist A", endpoint: { payload: { browseId: "UCa" } } },
          { text: " & " },
          { text: "Artist B", endpoint: { payload: { browseId: "UCb" } } },
        ] },
        thumbnails: thumbs,
      },
      contents: [{ type: "MusicResponsiveListItem", item_type: "song", id: "v3", title: "Track 3" }],
      sections: [],
    });
    expect(album.tracks[0]).toMatchObject({
      artists: ["Artist A", "Artist B"], artistIds: ["UCa", "UCb"], album: { id: "MPREb_2", title: "Album Y" }, subtitle: "Artist A, Artist B • Album Y",
    });
  });

  it("never takes the year for the artist of an old-style header without a strapline", () => {
    const album = mapAlbum("MPREb_3", {
      header: { title: { text: "Album Z" }, subtitle: { text: "Album • 2019" }, thumbnails: thumbs },
      contents: [{ type: "MusicResponsiveListItem", item_type: "song", id: "v4", title: "Track 4" }],
      sections: [],
    });
    expect(album.tracks[0].artists).toEqual([]);
  });

  it("maps artist with immersive header", () => {
    const artist = mapArtist("UC1", {
      header: { title: { text: "Artist A" }, thumbnail: { contents: thumbs } },
      sections: [{ type: "MusicShelf", title: { text: "Songs" }, contents: [song] }],
    });
    expect(artist).toMatchObject({ id: "UC1", title: "Artist A", thumbnail: "mid.jpg" });
    expect(artist.shelves[0].title).toBe("Songs");
  });
});
