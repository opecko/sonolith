import { describe, expect, it } from "vitest";
import channel from "./__fixtures__/podcast-channel.json";
import episodeNext from "./__fixtures__/episode-next.json";
import episodesForLater from "./__fixtures__/episodes-for-later.json";
import libraryPodcasts from "./__fixtures__/library-podcasts.json";
import search from "./__fixtures__/podcast-search.json";
import show from "./__fixtures__/podcast-show-live.json";
import { searchPage } from "./browse";
import { parseChannel, parseShow } from "./podcast";
import { parseNext } from "./queue";
import { flattenPage, parseBrowse } from "./raw";
import { isEpisode, isShow, type Item, type Track } from "./types";

// Live responses (trimmed; the library ones anonymized) captured with scripts in the session scratchpad.
describe("podcasts from live responses", () => {
  it("search: episodes are episodes (not songs), shows are shows", async () => {
    const res = await searchPage(async () => search, "huberman lab");
    const all: Item[] = [...(res.top ? [res.top] : []), ...res.groups.flatMap((g) => g.items)];
    const ep = all.find((i) => i.id === "In9Bq4EJMZw") as Track & Item;
    expect(ep).toBeDefined();
    expect(isEpisode(ep)).toBe(true);
    expect(ep.artists).toEqual([]);
    expect(ep.show).toEqual({ id: "PLPNW_gerXa4Pc8S2qoUQc5e8Ir97RLuVW", title: "Huberman Lab" });
    expect(ep.episode?.published).toBe("Dec 5, 2024");
    expect(ep.subtitle).toBe("Dec 5, 2024 • Huberman Lab");
    const shows = all.filter(isShow);
    expect(shows.length).toBeGreaterThan(0);
    expect(shows[0]).toMatchObject({ type: "playlist", podcast: true, title: "Huberman Lab" });
    // Nothing podcast-like slipped in as a song.
    expect(all.filter((i) => i.type === "track" && (i as Track).artists?.includes("Episode"))).toEqual([]);
  });

  it("show page: title, author, description, filter chips and episodes with progress", () => {
    const s = parseShow(show);
    expect(s.title).toBe("Huberman Lab");
    expect(s.channel?.name).toBe("Andrew Huberman");
    expect(s.description).toMatch(/Huberman/);
    expect(s.chips.map((c) => c.label)).toEqual(expect.arrayContaining(["Latest", "Played"]));
    expect(s.episodes.length).toBeGreaterThan(0);
    for (const e of s.episodes) {
      expect(isEpisode(e)).toBe(true);
      expect(e.episode?.durationText ?? e.episode?.progress?.text).toBeTruthy();
    }
  });

  it("the episode in /next is an episode of its show (byline = show, no artists)", () => {
    const n = parseNext(episodeNext);
    const t = n.tracks.find((x) => x.id === "YdIJW8RTptU")!;
    expect(isEpisode(t)).toBe(true);
    expect(t.artists).toEqual([]);
    expect(t.show).toEqual({ id: "PLPNW_gerXa4Pc8S2qoUQc5e8Ir97RLuVW", title: "Huberman Lab" });
    expect(t.durationSec).toBe(1818);
  });

  it("channel page: episodes and shows on their shelves", () => {
    const c = parseChannel("UC2D2CMWXMOVWx7giW1n3LIg", channel);
    const items = c.shelves.flatMap((s) => s.items);
    expect(items.filter(isEpisode).length).toBeGreaterThan(0);
    expect(items.filter(isShow).length).toBeGreaterThan(0);
  });

  it("library: saved podcasts are shows; an empty Episodes for later parses to nothing", () => {
    const shows = flattenPage(parseBrowse(libraryPodcasts)).items.filter(isShow);
    expect(shows.length).toBeGreaterThan(0);
    expect(flattenPage(parseBrowse(episodesForLater)).items).toEqual([]);
  });
});
