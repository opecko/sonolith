import { create } from "zustand";
import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from "../theme/appearance";

interface Settings {
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
}

const KEY = "settings";
const DEFAULTS: Settings = { autoplay: true, discordRpc: true, discordButton: true, saveHistory: true, podcastSpeed: 1, discordPodcasts: false, updateCheck: true, appearance: DEFAULT_APPEARANCE };

function read(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Settings saved before 1.2 have no `appearance`; normalizing also drops malformed values.
    return { ...DEFAULTS, ...stored, appearance: normalizeAppearance(stored.appearance) };
  } catch {
    return DEFAULTS;
  }
}

function write() {
  try {
    const { autoplay, discordRpc, discordButton, saveHistory, podcastSpeed, discordPodcasts, updateCheck, appearance } = useSettings.getState();
    localStorage.setItem(KEY, JSON.stringify({ autoplay, discordRpc, discordButton, saveHistory, podcastSpeed, discordPodcasts, updateCheck, appearance }));
  } catch {
    /* storage unavailable */
  }
}

// Live sliders (corner radius, ambient intensity) change settings on every pointer move; storage gets the result
// once things settle, and right away when the window hides or the page goes away.
let pending: ReturnType<typeof setTimeout> | undefined;
function flush() {
  if (pending === undefined) return;
  clearTimeout(pending);
  pending = undefined;
  write();
}
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => document.hidden && flush());

export const useSettings = create<Settings & { set: (patch: Partial<Settings>) => void }>((set) => ({
  ...read(),
  set: (patch) => {
    set(patch);
    clearTimeout(pending);
    pending = setTimeout(flush, 300);
  },
}));

/** Merges a change into the Appearance settings. */
export const setAppearance = (patch: Partial<Appearance>) =>
  useSettings.getState().set({ appearance: { ...useSettings.getState().appearance, ...patch } });
