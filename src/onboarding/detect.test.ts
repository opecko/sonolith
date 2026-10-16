import { describe, expect, it } from "vitest";
import { decideLocal, decideWithNative } from "./detect";

const none = { cookie: false, nativeFiles: false };

describe("first-run detection", () => {
  it("fresh install: nothing stored anywhere → onboarding", () => {
    expect(decideLocal({ settings: null, keys: [] })).toBe("ask");
    expect(decideWithNative(none)).toBe("show");
  });

  it("update from 1.3.0 data: settings without onboarding (and no lastSeenVersion) → existing", () => {
    const v13 = { autoplay: true, discordRpc: true, appearance: { palette: "x", mode: "dark" } };
    expect(decideLocal({ settings: v13, keys: ["volume", "queue-v1"] })).toBe("existing");
  });

  it("update where only other keys were stored (settings never changed) → existing", () => {
    expect(decideLocal({ settings: null, keys: ["volume"] })).toBe("existing");
    expect(decideLocal({ settings: null, keys: ["queue-v1"] })).toBe("existing");
  });

  it("update with only the sign-in cookie → existing", () => {
    expect(decideLocal({ settings: null, keys: [] })).toBe("ask");
    expect(decideWithNative({ cookie: true, nativeFiles: false })).toBe("existing");
  });

  it("update with only native files (config.json or a downloaded yt-dlp) → existing", () => {
    expect(decideWithNative({ cookie: false, nativeFiles: true })).toBe("existing");
  });

  it("onboarding interrupted (closed mid-way) → shows again", () => {
    expect(decideLocal({ settings: { onboardingCompleted: false, appearance: { palette: "y" } }, keys: [] })).toBe("show");
  });

  it("onboarding completed → never again, whatever else is stored", () => {
    expect(decideLocal({ settings: { onboardingCompleted: true }, keys: [] })).toBe("done");
    expect(decideLocal({ settings: { onboardingCompleted: true, lastSeenVersion: "2.0.0" }, keys: ["volume"] })).toBe("done");
  });
});
