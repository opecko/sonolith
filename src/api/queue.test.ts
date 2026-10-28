import { describe, expect, it } from "vitest";
import radio from "./__fixtures__/next-radio.json";
import { parseNext } from "./queue";

describe("parseNext", () => {
  const r = parseNext(radio);

  it("maps chips with their queue watch endpoints, skipping unusable ones", () => {
    expect(r.chips).toEqual([
      { id: "0:Vše", label: "Vše", selected: true, endpoint: { videoId: undefined, playlistId: "RDAMVMvid000000A1", params: "ALL" } },
      { id: "1:Rock", label: "Rock", selected: false, endpoint: { videoId: undefined, playlistId: "RDATrock", params: "ROCK" } },
    ]);
  });

  it("maps panel videos incl. wrappers, drops invalid ids and automix previews", () => {
    expect(r.tracks.map((t) => t.id)).toEqual(["vid000000A1", "vid000000B2"]);
    expect(r.tracks[0]).toMatchObject({ artists: ["Artist A"], album: { id: "MPREa", title: "Album A" }, durationSec: 211, explicit: true });
    expect(r.tracks[1]).toMatchObject({ artists: ["Artist B"], subtitle: "Artist B" });
  });

  it("reads continuation, header, automix seed and side tabs", () => {
    expect(r.continuation).toBe("RADIO2");
    expect(r.playlistId).toBe("RDAMVMvid000000A1");
    expect(r.header).toEqual({ title: "Přehrávání ze stanice", subtitle: "Mix z roku X" });
    expect(r.automix).toEqual({ playlistId: "RDAMPLx", params: "AUTO" });
    expect(r.lyrics).toEqual({ browseId: "MPLYt_x", params: undefined });
    expect(r.related).toEqual({ browseId: "MPTRt_x", params: undefined });
  });

  it("parses continuation responses and garbage without throwing", () => {
    const panel = radio.contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer.tabs[0].tabRenderer.content!.musicQueueRenderer.content.playlistPanelRenderer;
    const c = parseNext({ continuationContents: { playlistPanelContinuation: { contents: panel.contents, continuations: [{ nextContinuationData: { continuation: "N3" } }] } } });
    expect(c.tracks).toHaveLength(2);
    expect(c.continuation).toBe("N3");
    expect(parseNext(null)).toEqual({ tracks: [], chips: [] });
    expect(parseNext({ contents: "x" })).toEqual({ tracks: [], chips: [] });
  });
});

import { findRadioEndpoint } from "./queue";

describe("findRadioEndpoint", () => {
  const trackMenu = { menu: { items: [{ navigationEndpoint: { watchEndpoint: { videoId: "v", playlistId: "RDAMVMv", params: "wAEB" } } }] } };
  it("prefers the page header radio over per-track menus", () => {
    const album = { contents: { twoColumnBrowseResultsRenderer: {
      tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicResponsiveHeaderRenderer: { buttons: [{ menuRenderer: { items: [
        { menuNavigationItemRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: "RDAMPLOLAK5uy_x", params: "P" } } } }] } }] } }] } } } }],
      secondaryContents: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [trackMenu] } }] } },
    } } };
    expect(findRadioEndpoint(album)).toEqual({ playlistId: "RDAMPLOLAK5uy_x", params: "P", videoId: undefined });
  });
  it("finds artist header radio and ignores track lists / garbage", () => {
    expect(findRadioEndpoint({ header: { musicImmersiveHeaderRenderer: { startRadioButton: { buttonRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: "RDEMx" } } } } } } }))
      .toEqual({ playlistId: "RDEMx", params: undefined, videoId: undefined });
    expect(findRadioEndpoint({ contents: { twoColumnBrowseResultsRenderer: { secondaryContents: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: [trackMenu] } }] } } } } })).toBeNull();
    expect(findRadioEndpoint(null)).toBeNull();
  });
});

import { parseLyrics } from "./queue";
import { parseBrowse } from "./raw";

describe("now playing tabs", () => {
  it("parses lyrics text and source, null when absent", () => {
    const d = { contents: { sectionListRenderer: { contents: [{ musicDescriptionShelfRenderer: { description: { runs: [{ text: "line 1\nline 2" }] }, footer: { runs: [{ text: "Zdroj: LyricFind" }] } } }] } } };
    expect(parseLyrics(d)).toEqual({ text: "line 1\nline 2", source: "Zdroj: LyricFind" });
    expect(parseLyrics({ contents: { sectionListRenderer: { contents: [{ messageRenderer: {} }] } } })).toBeNull();
    expect(parseLyrics(null)).toBeNull();
  });
  it("parses related pages whose section list sits directly under contents", () => {
    const d = { contents: { sectionListRenderer: { contents: [
      { musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: "Podobní interpreti" }] } } }, contents: [
        { musicTwoRowItemRenderer: { title: { runs: [{ text: "A" }] }, navigationEndpoint: { browseEndpoint: { browseId: "UCa", browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" } } } } } }] } },
      { musicDescriptionShelfRenderer: { description: { runs: [{ text: "bio" }] } } },
    ] } } };
    expect(parseBrowse(d).shelves.map((s) => [s.title, s.items.length])).toEqual([["Podobní interpreti", 1]]);
  });
});

import { isMusicVideoType, mapPanelItems } from "./queue";

describe("music videos in the queue", () => {
  const item = (videoId: string, musicVideoType?: string) => ({
    playlistPanelVideoRenderer: {
      videoId,
      title: { runs: [{ text: videoId }] },
      longBylineText: { runs: [{ text: "Artist" }] },
      navigationEndpoint: { watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType } } } },
    },
  });
  it("marks official and uploaded videos, not songs", () => {
    const [omv, ugc, atv, none] = mapPanelItems([item("aaaaaaaaaaa", "MUSIC_VIDEO_TYPE_OMV"), item("bbbbbbbbbbb", "MUSIC_VIDEO_TYPE_UGC"), item("ccccccccccc", "MUSIC_VIDEO_TYPE_ATV"), item("ddddddddddd")]);
    expect([omv.video, ugc.video, atv.video, none.video]).toEqual([true, true, undefined, undefined]);
    expect(isMusicVideoType("MUSIC_VIDEO_TYPE_PODCAST_EPISODE")).toBe(false);
  });
});
