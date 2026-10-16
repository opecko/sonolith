import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../theme/appearance";
import { parseSettings } from "./settings";

describe("settings migration", () => {
  it("settings from 1.x get the 2.0 defaults", () => {
    const old = { autoplay: false, appearance: { palette: "nord", mode: "light", radius: 12 } };
    const s = parseSettings(old);
    expect(s.autoplay).toBe(false);
    expect(s.appearance).toMatchObject({ palette: "nord", mode: "light", radius: 12, uiStyle: "m3", nowPlayingLayout: "material", animations: true });
    expect(s.lastSeenVersion).toBeNull();
    expect(s.appearance.ambientQuality).toBe("medium");
  });

  it("keeps valid 2.0 values and drops malformed ones", () => {
    expect(parseSettings({ appearance: { uiStyle: "classic", nowPlayingLayout: "bento", animations: false }, lastSeenVersion: "2.0.0" }))
      .toMatchObject({ appearance: { uiStyle: "classic", nowPlayingLayout: "bento", animations: false }, lastSeenVersion: "2.0.0" });
    const bad = parseSettings({ appearance: { uiStyle: "m4", nowPlayingLayout: 3, animations: "yes" }, lastSeenVersion: 2 });
    expect(bad.appearance).toMatchObject({ uiStyle: "m3", nowPlayingLayout: "material", animations: true });
    expect(bad.lastSeenVersion).toBeNull();
  });

  it("garbage falls back to the defaults", () => {
    expect(parseSettings(null).appearance).toEqual(DEFAULT_APPEARANCE);
    expect(parseSettings("x").updateCheck).toBe(true);
  });
});
