import { describe, expect, it } from "vitest";
import playlists from "./__fixtures__/library-playlists.json";
import liked from "./__fixtures__/liked-songs.json";
import type { Track } from "./types";
import { flattenPage, mapRawItem, parseBrowse, parseDuration, runInfo } from "./raw";

describe("raw browse parser", () => {
  it("parses library grid, skips create button and unknown nodes", () => {
    const { items, next } = flattenPage(parseBrowse(playlists));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "playlist", id: "LM", title: "Hudba, která se líbila" });
    expect(next).toBe("TOKEN1");
  });

  it("parses liked songs playlist shelf with continuation item", () => {
    const { items, next } = flattenPage(parseBrowse(liked));
    expect(items[0]).toMatchObject({
      type: "track", id: "vid000000A1", artists: ["Artist A"], album: { id: "MPREa", title: "Album A" }, durationSec: 324, rating: "LIKE",
    });
    expect(next).toBe("TOKEN2");
  });

  it("parses continuation responses and empty/message pages", () => {
    const cont = { continuationContents: { gridContinuation: { items: playlists.contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].gridRenderer.items } } };
    expect(flattenPage(parseBrowse(cont))).toMatchObject({ next: null });
    expect(flattenPage(parseBrowse(cont)).items).toHaveLength(1);
    const appended = { onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: liked.contents.twoColumnBrowseResultsRenderer.secondaryContents.sectionListRenderer.contents[0].musicPlaylistShelfRenderer.contents } }] };
    expect(flattenPage(parseBrowse(appended)).next).toBe("TOKEN2");
    const msg = { contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [{ messageRenderer: { text: { runs: [{ text: "Empty" }] } } }] } }] } } } }] } } };
    expect(flattenPage(parseBrowse(msg))).toEqual({ items: [], next: null, messages: ["Empty"] });
    expect(parseBrowse(null)).toEqual({ shelves: [], chips: [], messages: [], next: null });
  });

  it("parses durations", () => {
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("Album")).toBeUndefined();
  });
});

import home from "./__fixtures__/home.json";

describe("home feed", () => {
  const page = parseBrowse(home);
  it("parses mood chips, shelf metadata and continuation", () => {
    expect(page.chips).toEqual([{ label: "Relax", selected: false, browse: { browseId: "FEmusic_home", params: "RELAX" }, searchParams: undefined }]);
    expect(page.next).toBe("HOME2");
    expect(page.shelves.map((s) => [s.title, s.strapline, s.more?.browseId, !!s.compact])).toEqual([
      ["Poslechnout znovu", "PODOBNÉ JAKO", "FEmusic_listen_again", false],
      ["Rychlý výběr", undefined, undefined, true],
    ]);
  });
  it("maps card variants", () => {
    const [artist, video, mix] = page.shelves[0].items;
    expect(artist).toMatchObject({ type: "artist", art: "round" });
    expect(video).toMatchObject({ type: "track", id: "vid000000LO", art: "wide", artists: ["Tame Impala"] });
    expect(mix).toMatchObject({ type: "playlist", id: "RDTMAK5uy_mix" });
  });
});

describe("runInfo", () => {
  const nav = (pageType: string, browseId: string) => ({
    browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } },
  });
  it("keeps each artist's browse id next to its name", () => {
    const info = runInfo([
      { text: "A", navigationEndpoint: nav("MUSIC_PAGE_TYPE_ARTIST", "UCa") },
      { text: " & " },
      { text: "B", navigationEndpoint: nav("MUSIC_PAGE_TYPE_ARTIST", "UCb") },
      { text: " • " },
      { text: "Alb", navigationEndpoint: nav("MUSIC_PAGE_TYPE_ALBUM", "MPREx") },
    ]);
    expect(info.artists).toEqual(["A", "B"]);
    expect(info.artistIds).toEqual(["UCa", "UCb"]);
    expect(info.album).toEqual({ id: "MPREx", title: "Alb" });
  });
});

describe("song rows", () => {
  it("finds the length before a plays count (search results)", () => {
    const col = (...texts: string[]) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs: texts.map((text) => ({ text })) } } });
    const row = {
      musicResponsiveListItemRenderer: {
        playlistItemData: { videoId: "e1N_fJlJaXY" },
        flexColumns: [col("Reality In Motion"), col("Tame Impala", " • ", "Currents", " • ", "4:13"), col("11M plays")],
      },
    };
    expect(mapRawItem(row)).toMatchObject({ type: "track", title: "Reality In Motion", durationSec: 253 });
  });

  it("keeps each playlist entry's own id: the same song twice has two", () => {
    const col = (text: string) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text }] } } });
    const row = (setId?: string) => ({
      musicResponsiveListItemRenderer: {
        playlistItemData: { videoId: "e1N_fJlJaXY", ...(setId ? { playlistSetVideoId: setId } : {}) },
        flexColumns: [col("Reality In Motion"), col("Tame Impala")],
      },
    });
    const a = mapRawItem(row("56B44F6D10557CC6")) as Track;
    const b = mapRawItem(row("A1C2E3F4A5B6C7D8")) as Track;
    expect([a.id, b.id]).toEqual(["e1N_fJlJaXY", "e1N_fJlJaXY"]);
    expect([a.setVideoId, b.setVideoId]).toEqual(["56B44F6D10557CC6", "A1C2E3F4A5B6C7D8"]);
    // Playlists the user can't edit carry no entry ids.
    expect((mapRawItem(row()) as Track).setVideoId).toBeUndefined();
  });

  it("tells the user's own playlist by its editable header, with its privacy", () => {
    // The shape of a real own-playlist page (2026-10), trimmed to the header.
    const pageWith = (header: object) => ({
      contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [header] } } } }] } },
    });
    const own = pageWith({
      musicEditablePlaylistDetailHeaderRenderer: {
        header: { musicResponsiveHeaderRenderer: {} },
        editHeader: { musicPlaylistEditHeaderRenderer: { privacy: "PRIVATE" } },
      },
    });
    expect(parseBrowse(own).own).toEqual({ privacy: "PRIVATE" });
    expect(parseBrowse(pageWith({ musicResponsiveHeaderRenderer: {} })).own).toBeUndefined();
  });
});
