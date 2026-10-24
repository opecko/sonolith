import { describe, expect, it } from "vitest";
import episodePage from "./__fixtures__/episode-page.json";
import show from "./__fixtures__/podcast-show.json";
import { parseChannel, parseEpisode, parseShow, parseSpokenDuration } from "./podcast";

describe("podcast show", () => {
  const s = parseShow(show);
  it("parses the header, channel and library state", () => {
    expect(s).toMatchObject({
      title: "Season 10",
      description: "The 10th Season",
      channel: { id: "UCcast", name: "The Linux Cast" },
      saved: true,
      playlistId: "PLcast",
    });
  });
  it("parses filter chips incl. the Latest/Oldest dropdown", () => {
    expect(s.chips).toEqual([
      { label: "Latest", selected: false, options: [{ label: "Latest", token: "NEW", selected: true }, { label: "Oldest", token: "OLD", selected: false }] },
      { label: "Unplayed", selected: false, token: "UNP" },
    ]);
  });
  it("parses episodes with description and listening progress", () => {
    expect(s.episodes[0]).toMatchObject({
      id: "EA3NrSX0kTc", podcast: true,
      episode: { meta: "2.4K views • 8h ago", description: "The boys are back!", durationText: "57 min", progress: { percent: 93, text: "3 min left", played: false } },
    });
    expect(s.next).toBe("MORE");
  });
});

it("parses a channel header", () => {
  const c = parseChannel("UCx", { header: { musicVisualHeaderRenderer: {
    title: { runs: [{ text: "The Linux Cast" }] },
    subscriptionButton: { subscribeButtonRenderer: { subscribed: true, channelId: "UCcast", subscriberCountText: { runs: [{ text: "75.3K" }] } } },
  } } });
  expect(c).toMatchObject({ id: "UCcast", title: "The Linux Cast", subscribed: true, subscribers: "75.3K", shelves: [] });
});

describe("episode page", () => {
  it("parses the episode, its show, progress and the full description", () => {
    const e = parseEpisode("YdIJW8RTptU", episodePage)!;
    expect(e.title).toBe("Essentials: Neuralink & Technologies to Enhance Human Brains | Dr. Matt MacDougall");
    expect(e.podcast).toBe(true);
    expect(e.show).toEqual({ id: "PLPNW_gerXa4Pc8S2qoUQc5e8Ir97RLuVW", title: "Huberman Lab" });
    expect(e.episode?.published).toBe("1d ago");
    expect(e.durationSec).toBe(30 * 60);
    expect(e.episode?.description).toContain("Dr. Matthew MacDougall");
    expect(e.episode?.description).toContain("https://www.hubermanlab.com/disclaimer");
    expect(e.episode?.description).not.toContain("e...");
    expect(e.thumbnail).toMatch(/^https:/);
  });

  it("is null for a page without an episode header", () => {
    expect(parseEpisode("x", {})).toBeNull();
  });

  it("reads spoken lengths", () => {
    expect(parseSpokenDuration("1 hr 5 min")).toBe(3900);
    expect(parseSpokenDuration("45 sec")).toBe(45);
    expect(parseSpokenDuration("soon")).toBeUndefined();
  });
});
