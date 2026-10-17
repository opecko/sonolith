import { describe, expect, it } from "vitest";
import daily from "./__fixtures__/search-the-daily.json";
import huberman from "./__fixtures__/search-huberman-lab.json";
import joeRogan from "./__fixtures__/search-joe-rogan.json";
import kendrick from "./__fixtures__/search-kendrick-lamar.json";
import lex from "./__fixtures__/search-lex-fridman.json";
import radiohead from "./__fixtures__/search-radiohead.json";
import serial from "./__fixtures__/search-serial.json";
import { searchPage } from "./browse";
import { isPodcastSearch, normalizeQuery, podcastsFirst } from "./searchOrder";
import type { Item } from "./types";

// Live YouTube Music search responses (trimmed), captured from the session scratchpad.
const run = (data: unknown, q: string) => searchPage(async () => data, q);
const ids = (r: Awaited<ReturnType<typeof run>>) => r.groups.map((g) => g.id);

describe("podcast searches put podcasts first", () => {
  it.each([
    ["huberman lab", huberman],
    ["lex fridman", lex],
    ["the daily", daily],
  ])("%s → podcasts, then episodes, first", async (q, data) => {
    const r = await run(data, q);
    expect(r.podcastFirst).toBe(true);
    expect(ids(r).slice(0, 2)).toEqual(["podcasts", "episodes"]);
  });

  it.each([
    ["radiohead", radiohead],
    ["kendrick lamar", kendrick],
    // A music top result (a song) decides, though a show called Serial exists.
    ["serial", serial],
    // Only a show that mentions the name somewhere: not a podcast search.
    ["joe rogan", joeRogan],
  ])("%s → YouTube Music's order", async (q, data) => {
    const r = await run(data, q);
    expect(r.podcastFirst).toBe(false);
    // Exactly as sent (the same response read without a query, which never reorders).
    expect(ids(r)).toEqual(ids(await run(data, "")));
  });

  it("keeps the groups in the order YouTube Music sent them for music", async () => {
    const r = await run(radiohead, "radiohead");
    expect(ids(r)).toEqual(["songs", "albums"]);
  });
});

describe("decision rules", () => {
  const show = (title: string): Item => ({ type: "playlist", id: "p", title, subtitle: "", podcast: true });
  const artist: Item = { type: "artist", id: "a", title: "Serial", subtitle: "" };
  const groups = (title: string) => [{ id: "songs" as const, items: [] }, { id: "podcasts" as const, items: [show(title)] }];

  it("normalizes case, diacritics and punctuation", () => {
    expect(normalizeQuery("  Čeština: Dobrý-podcast! ")).toBe("cestina dobry podcast");
  });
  it("matches the show's name exactly or as its start", () => {
    expect(isPodcastSearch("Lex Fridman", [], groups("Lex Fridman Podcast"))).toBe(true);
    expect(isPodcastSearch("lex", [], groups("Lexicon Valley"))).toBe(false);
    expect(isPodcastSearch("joe rogan", [], groups("Glenn (Joe Rogan Experience)"))).toBe(false);
  });
  it("a music top result wins over a matching show", () => {
    expect(isPodcastSearch("serial", [artist], groups("Serial"))).toBe(false);
    expect(isPodcastSearch("serial", [show("Serial")], groups("Serial"))).toBe(true);
  });
  it("moves only the podcast groups, keeping the rest in order", () => {
    const g = [{ id: "songs" }, { id: "albums" }, { id: "episodes" }, { id: "podcasts" }] as const;
    expect(podcastsFirst([...g]).map((x) => x.id)).toEqual(["episodes", "podcasts", "songs", "albums"]);
  });
});
