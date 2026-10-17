import { describe, expect, it } from "vitest";
import search from "./__fixtures__/search.json";
import { parseAccount, parseSuggestions, toSearchResults } from "./browse";
import { parseBrowse } from "./raw";

describe("search", () => {
  const res = toSearchResults(parseBrowse(search));

  it("extracts the top result card and its inline tracks", () => {
    expect(res.top.map((i) => [i.type, i.id])).toEqual([["artist", "UCtame"], ["track", "vid0000000B"]]);
    expect(res.top[0].art).toBe("round");
  });

  it("groups loose single-item sections by item type, not locale labels, in the response's order", () => {
    expect(res.groups.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([
      ["albums", ["MPREcur"]],
      ["songs", ["vid0000000M"]],
      ["videos", ["vid0000000V"]],
    ]);
    expect(res.groups.find((g) => g.id === "songs")!.items[0]).toMatchObject({ kind: "Skladba", artists: ["Tame Impala"] });
    expect(res.shelves).toEqual([]);
  });

  it("exposes filter chips with search params", () => {
    expect(res.chips).toEqual([{ label: "Skladby", selected: false, browse: undefined, searchParams: "SONGS" }]);
  });
});

it("parses suggestions", () => {
  const data = { contents: [{ searchSuggestionsSectionRenderer: { contents: [
    { searchSuggestionRenderer: { navigationEndpoint: { searchEndpoint: { query: "tame impala live" } } } },
    { searchSuggestionRenderer: { suggestion: { runs: [{ text: "tame" }, { text: " impala" }] } } },
  ] } }] };
  expect(parseSuggestions(data)).toEqual({ queries: ["tame impala live", "tame impala"], items: [] });
  expect(parseSuggestions(null)).toEqual({ queries: [], items: [] });
});

it("parses account header", () => {
  const data = { actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { header: { activeAccountHeaderRenderer: {
    accountName: { simpleText: "Ondra" }, accountPhoto: { thumbnails: [{ url: "https://x/p.jpg", width: 88 }] },
  } } } } } }] };
  expect(parseAccount(data)).toEqual({ name: "Ondra", handle: undefined, photo: "https://x/p.jpg" });
  expect(parseAccount({})).toBeNull();
});
