import { describe, expect, it } from "vitest";
import { fold, rankItems, type PaletteItem } from "./rank";

const items: PaletteItem[] = [
  { id: "home", title: "Home", group: "Go to" },
  { id: "np", title: "Now Playing", group: "Go to", keywords: ["player", "full screen"] },
  { id: "next", title: "Next track", group: "Playback", keywords: ["skip"] },
  { id: "look", title: "Look", group: "Settings", keywords: ["animations", "transparent window"] },
  { id: "shortcuts", title: "Keyboard shortcuts", group: "Settings", keywords: ["keys"] },
];
const ids = (q: string) => rankItems(q, items).map((i) => i.id);

describe("command palette ranking", () => {
  it("an empty query lists everything in order", () => {
    expect(ids("")).toEqual(["home", "np", "next", "look", "shortcuts"]);
    expect(ids("   ")).toEqual(["home", "np", "next", "look", "shortcuts"]);
  });

  it("a title's start beats a word's start beats the keywords", () => {
    expect(ids("n")[0]).toBe("np");
    expect(ids("play")).toEqual(["np", "next"]);
    expect(ids("skip")).toEqual(["next"]);
    expect(ids("shortcuts")).toEqual(["shortcuts"]);
  });

  it("every word must fit, in any order, case and diacritics aside", () => {
    expect(ids("playing now")).toEqual(["np"]);
    expect(ids("TRANSPARENT")).toEqual(["look"]);
    expect(ids("keyboard xyz")).toEqual([]);
    expect(fold("  Přehrávání  Teď ")).toBe("prehravani ted");
  });

  it("letters in order find a title too", () => {
    expect(ids("nwp")).toEqual(["np"]);
  });
});
