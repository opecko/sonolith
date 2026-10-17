import { describe, expect, it } from "vitest";
import type { Track } from "../api/types";
import { bylineParts } from "./TrackByline";

const track = (p: Partial<Track>): Track => ({ type: "track", id: "x", title: "T", subtitle: "", artists: [], ...p });

describe("bylineParts", () => {
  it("links every artist with an id and the album, keeping the rest of the text", () => {
    const t = track({ artists: ["Simon & Garfunkel", "Paul Simon"], artistIds: ["UC1", "UC2"], album: { id: "MPRE1", title: "Bookends" } });
    expect(bylineParts("Song • Simon & Garfunkel, Paul Simon • Bookends • 3:21", t)).toEqual([
      "Song • ",
      { kind: "artist", id: "UC1", text: "Simon & Garfunkel" },
      ", ",
      { kind: "artist", id: "UC2", text: "Paul Simon" },
      " • ",
      { kind: "album", id: "MPRE1", text: "Bookends" },
      " • 3:21",
    ]);
  });

  it("leaves names without an id as plain text", () => {
    const t = track({ artists: ["A", "B"], artistIds: [undefined, "UCb"], album: { title: "Alb" } });
    expect(bylineParts("A, B • Alb", t)).toEqual(["A, ", { kind: "artist", id: "UCb", text: "B" }, " • Alb"]);
  });

  it("matches whole names only", () => {
    const t = track({ artists: ["Ann"], artistIds: ["UCa"] });
    expect(bylineParts("Annie, Ann", t)).toEqual(["Annie, ", { kind: "artist", id: "UCa", text: "Ann" }]);
  });

  it("links an episode's show", () => {
    const t = track({ podcast: true, show: { id: "PLshow", title: "The Show" } });
    expect(bylineParts("Dec 5, 2024 • The Show", t)).toEqual(["Dec 5, 2024 • ", { kind: "show", id: "PLshow", text: "The Show" }]);
  });

  it("returns the text unchanged when nothing has an id", () => {
    expect(bylineParts("A • B", track({ artists: ["A"] }))).toEqual(["A • B"]);
    expect(bylineParts("", track({ artists: ["A"], artistIds: ["UC"] }))).toEqual([]);
  });
});
