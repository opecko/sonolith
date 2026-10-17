import { describe, expect, it } from "vitest";
import type { Track } from "./types";
import { APP_ASSET, buildActivity, fit } from "./discord";

const track: Track = {
  type: "track", id: "vid000000A1", title: "Loser", subtitle: "Tame Impala • Deadbeat", artists: ["Tame Impala"],
  album: { id: "MPREa", title: "Deadbeat" }, thumbnail: "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj",
};

describe("buildActivity", () => {
  it("builds a Listening activity with art, album, progress and button", () => {
    const a = buildActivity({ track, playing: true, position: 30, duration: 223, button: true, now: 1_000_000 });
    expect(a).toEqual({
      type: 2,
      status_display_type: 2,
      details: "Loser",
      state: "Tame Impala",
      assets: { large_image: "https://lh3.googleusercontent.com/abc=w512-h512-l90-rj", large_text: "Deadbeat", small_image: APP_ASSET, small_text: "ytdesk" },
      timestamps: { start: 970_000, end: 1_193_000 },
      buttons: [{ label: "Listen on YouTube Music", url: "https://music.youtube.com/watch?v=vid000000A1" }],
    });
  });

  it("an episode says it's a podcast and names its show", () => {
    const ep: Track = { type: "track", id: "vid000000E1", title: "Sleep", subtitle: "Dec 5, 2024 • Huberman Lab", artists: [], podcast: true, show: { id: "PLx", title: "Huberman Lab" } };
    const a = buildActivity({ track: ep, playing: true, position: 0, duration: 600, button: false, now: 0 });
    expect(a.state).toBe("Podcast · Huberman Lab");
    expect(a.assets.large_text).toBe("Huberman Lab");
  });

  it("shows Paused without timestamps, and drops the button when disabled", () => {
    const a = buildActivity({ track, playing: false, position: 30, duration: 223, button: false });
    expect(a.details).toBe("Loser");
    expect(a.state).toBe("Paused · Tame Impala");
    expect(a.assets.small_text).toBe("Paused");
    expect(a.timestamps).toBeUndefined();
    expect(a.buttons).toBeUndefined();
  });

  it("falls back to the app asset and omits missing album", () => {
    const a = buildActivity({ track: { ...track, thumbnail: undefined, album: undefined }, playing: true, position: 0, duration: 0, button: false });
    expect(a.assets.large_image).toBe(APP_ASSET);
    expect(a.assets.large_text).toBeUndefined();
    expect(a.timestamps).toBeUndefined();
  });
});

it("fits strings to Discord's 2..128 character limits", () => {
  expect(fit("A")).toBe("A ");
  expect(fit("  ")).toBeUndefined();
  expect([...fit("x".repeat(200))!]).toHaveLength(128);
});
