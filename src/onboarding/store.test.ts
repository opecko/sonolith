import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => false) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "2.0.0") }));
vi.mock("../api/client", () => ({ getCookie: async () => null }));

const { finishOnboarding, rerunOnboarding, useOnboarding } = await import("./store");
const { setAppearance, useSettings } = await import("../stores/settings");
const { useWhatsNew } = await import("../whatsNew/store");

const snapshot = () => {
  const { set: _set, ...rest } = useSettings.getState();
  return JSON.parse(JSON.stringify(rest));
};

describe("running the setup again (Settings → About)", () => {
  // An onboarded user with non-default choices.
  useSettings.getState().set({ onboardingCompleted: true, lastSeenVersion: "2.0.0", autoplay: false });
  setAppearance({ palette: "nord", mode: "light", uiStyle: "classic", nowPlayingLayout: "bento", ambient: false, coverColors: true });

  it("opening and closing it changes no setting", () => {
    const before = snapshot();
    rerunOnboarding();
    expect(useOnboarding.getState()).toMatchObject({ open: true, rerun: true, preview: null });
    finishOnboarding();
    expect(useOnboarding.getState()).toMatchObject({ open: false, rerun: false });
    expect(snapshot()).toEqual(before);
    expect(useSettings.getState().onboardingCompleted).toBe(true);
    expect(useWhatsNew.getState().entry).toBeNull();
  });

  it("only what the user changes in it changes, and it stays after closing", () => {
    const before = snapshot();
    rerunOnboarding();
    setAppearance({ palette: "dracula" });
    finishOnboarding();
    expect(snapshot()).toEqual({ ...before, appearance: { ...before.appearance, palette: "dracula" } });
    expect(useSettings.getState().onboardingCompleted).toBe(true);
  });
});
