import { create } from "zustand";
import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from "../theme/appearance";

export interface Settings {
  autoplay: boolean;
  /** Discord Rich Presence ("Listening to ytdesk"). */
  discordRpc: boolean;
  /** "Listen on YouTube Music" button in the presence. */
  discordButton: boolean;
  /** Add played songs to the YouTube Music history (also feeds recommendations). */
  saveHistory: boolean;
  /** Playback speed for podcast episodes (music always plays at 1×). */
  podcastSpeed: number;
  /** Show podcast episodes in Discord Rich Presence. */
  discordPodcasts: boolean;
  /** Look for a newer GitHub release on startup. */
  updateCheck: boolean;
  /** Colors, Now Playing ambient and other visual options (Settings → Appearance). */
  appearance: Appearance;
  /** App version whose "What's new" was handled (shown, or skipped on a fresh install); null before 2.0. */
  lastSeenVersion: string | null;
  /** The first-run welcome was finished or skipped (existing installs get it set silently, see onboarding/detect). */
  onboardingCompleted: boolean;
}

const KEY = "settings";
const DEFAULTS: Settings = { autoplay: true, discordRpc: true, discordButton: true, saveHistory: true, podcastSpeed: 1, discordPodcasts: false, updateCheck: true, appearance: DEFAULT_APPEARANCE, lastSeenVersion: null, onboardingCompleted: false };

/** Stored JSON → Settings. Missing keys (older versions) get the defaults; normalizing drops malformed values. */
export function parseSettings(stored: unknown): Settings {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    ...DEFAULTS,
    ...(s as Partial<Settings>),
    // Settings saved before 1.2 have no `appearance`, before 2.0 no style, Now Playing layout or animations.
    appearance: normalizeAppearance(s.appearance),
    lastSeenVersion: typeof s.lastSeenVersion === "string" ? s.lastSeenVersion : null,
    // Missing before 2.0; whether that's an existing install is decided at startup from the raw stored object.
    onboardingCompleted: s.onboardingCompleted === true,
  };
}

/** The settings object as stored when the app started (null: none), for the first-run detection. */
export let storedSettings: Record<string, unknown> | null = null;

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = JSON.parse(raw ?? "null");
    storedSettings = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : raw === null ? null : {};
    return parseSettings(parsed);
  } catch {
    return DEFAULTS;
  }
}

function write() {
  try {
    const { autoplay, discordRpc, discordButton, saveHistory, podcastSpeed, discordPodcasts, updateCheck, appearance, lastSeenVersion, onboardingCompleted } = useSettings.getState();
    localStorage.setItem(KEY, JSON.stringify({ autoplay, discordRpc, discordButton, saveHistory, podcastSpeed, discordPodcasts, updateCheck, appearance, lastSeenVersion, onboardingCompleted }));
  } catch {
    /* storage unavailable */
  }
}

// Live sliders (corner radius, ambient intensity) change settings on every pointer move; storage gets the result
// once things settle, and right away when the window hides or the page goes away.
let pending: ReturnType<typeof setTimeout> | undefined;
/** Writes pending changes now (the onboarding's flags must survive the app being closed right away). */
export function flush() {
  if (pending === undefined) return;
  clearTimeout(pending);
  pending = undefined;
  write();
}
// Not in unit tests, which only use parseSettings.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.hidden && flush());
}

export const useSettings = create<Settings & { set: (patch: Partial<Settings>) => void }>((set) => ({
  ...(typeof localStorage === "undefined" ? DEFAULTS : read()),
  set: (patch) => {
    set(patch);
    clearTimeout(pending);
    pending = setTimeout(flush, 300);
  },
}));

/** Merges a change into the Appearance settings. */
export const setAppearance = (patch: Partial<Appearance>) =>
  useSettings.getState().set({ appearance: { ...useSettings.getState().appearance, ...patch } });
