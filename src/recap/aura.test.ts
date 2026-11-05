import { describe, expect, it } from "vitest";
import { auraTrail } from "./aura";
import type { Slide } from "./deck";

const card = (kind: Slide["kind"], image?: string): Slide => ({
  kind, headline: "", aria: "", duration: 1, style: null, mood: "dark", useAlt: false,
  data: image ? { shape: "hero", item: { label: "x", image } } : { shape: "number", value: 1, display: "1", unit: "" },
});

describe("auraTrail", () => {
  it("starts with the last played song and changes only at big moments", () => {
    const slides = [card("intro"), card("totalTime"), card("topArtist", "artist.jpg"), card("calendar"), card("hours"), card("topTrack", "song.jpg"), card("outro")];
    expect(auraTrail(slides, "playing.jpg")).toEqual(["playing.jpg", "playing.jpg", "artist.jpg", "artist.jpg", "artist.jpg", "song.jpg", "song.jpg"]);
  });
  it("cards that aren't moments never change it, even with a cover", () => {
    expect(auraTrail([card("intro"), card("firstLast", "x.jpg")], undefined)).toEqual([undefined, undefined]);
  });
});
