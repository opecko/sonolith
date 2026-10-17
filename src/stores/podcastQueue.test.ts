import { describe, expect, it } from "vitest";
import type { Track } from "../api/types";
import { nextEpisode } from "./podcastQueue";

const ep = (id: string): Track => ({ type: "track", id, title: id, subtitle: "", artists: [], podcast: true });
const show = [ep("e3"), ep("e2"), ep("e1")]; // newest first

describe("next episode of a show", () => {
  it("is the next newer one", () => {
    expect(nextEpisode(show, "e1")?.id).toBe("e2");
    expect(nextEpisode(show, "e2")?.id).toBe("e3");
  });
  it("none after the newest, or for an episode not in the list", () => {
    expect(nextEpisode(show, "e3")).toBeNull();
    expect(nextEpisode(show, "x")).toBeNull();
    expect(nextEpisode([], "e1")).toBeNull();
  });
});
