// What the command palette offers: places, playback and settings, each running the same action as its button.
import { openSearch, openSettings, SETTINGS_SECTIONS, useNav, type SettingsSection } from "../stores/nav";
import { usePlayer } from "../stores/player";
import { setAppearance, useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";
import type { PaletteItem } from "./rank";

export interface Command extends PaletteItem {
  run: () => void;
}

const SECTION_TITLES: Record<SettingsSection, [string, string[]]> = {
  look: ["Look", ["animations", "transparent window", "opacity", "size", "font", "density", "corners"]],
  colors: ["Colors", ["palette", "theme", "dark", "light", "album art"]],
  nowplaying: ["Now Playing", ["layout", "ambient light", "visualizer", "save button"]],
  playback: ["Playback", ["autoplay", "gapless", "history", "podcasts", "notifications"]],
  lyrics: ["Lyrics", ["karaoke", "providers"]],
  recaps: ["Recaps", ["stats", "takeout"]],
  shortcuts: ["Keyboard shortcuts", ["keys", "hotkeys"]],
  discord: ["Discord", ["rich presence"]],
  apps: ["Connected apps", ["local api", "integrations"]],
  remote: ["Phone remote", ["remote control", "mobile", "qr code", "pair phone"]],
  system: ["System", ["tray", "graphics", "gpu", "updates", "yt-dlp"]],
  about: ["About", ["version", "changelog", "setup", "license"]],
};

const go = (name: "home" | "explore" | "library" | "history" | "recaps") => () => {
  useUi.getState().setNowPlaying(false);
  useNav.getState().go({ name });
};

/** Every command, in the order an empty query lists them. */
export function commands(): Command[] {
  const p = usePlayer.getState;
  const hasTrack = p().index >= 0;
  const list: Command[] = [
    { id: "go-home", title: "Home", group: "Go to", run: go("home") },
    { id: "go-explore", title: "Explore", group: "Go to", keywords: ["moods", "genres", "charts", "new releases"], run: go("explore") },
    { id: "go-library", title: "Library", group: "Go to", keywords: ["playlists", "albums", "artists", "liked"], run: go("library") },
    { id: "go-history", title: "History", group: "Go to", keywords: ["recently played"], run: go("history") },
    { id: "go-recaps", title: "Recaps", group: "Go to", keywords: ["stats", "year", "month", "wrapped"], run: go("recaps") },
    { id: "go-settings", title: "Settings", group: "Go to", keywords: ["preferences", "options"], run: () => openSettings() },
  ];
  if (hasTrack) {
    const open = useUi.getState().nowPlaying;
    list.push(
      { id: "now-playing", title: open ? "Close Now Playing" : "Now Playing", group: "Go to", keywords: ["player", "full screen", "cover"], run: () => useUi.getState().setNowPlaying(!open) },
      { id: "play-pause", title: p().status === "playing" ? "Pause" : "Play", group: "Playback", keywords: ["resume", "stop"], run: () => p().togglePlay() },
      { id: "next", title: "Next track", group: "Playback", keywords: ["skip"], run: () => p().next() },
      { id: "prev", title: "Previous track", group: "Playback", keywords: ["back"], run: () => p().prev() },
      { id: "shuffle", title: p().shuffle ? "Shuffle off" : "Shuffle on", group: "Playback", keywords: ["random"], run: () => p().toggleShuffle() },
      { id: "repeat", title: "Change repeat", group: "Playback", keywords: ["loop", "repeat one", "repeat all"], run: () => p().cycleRepeat() },
      { id: "mute", title: p().muted ? "Unmute" : "Mute", group: "Playback", keywords: ["sound", "volume"], run: () => p().toggleMute() },
    );
  }
  const a = useSettings.getState().appearance;
  list.push(
    { id: "mode", title: a.mode === "dark" ? "Light mode" : "Dark mode", group: "Appearance", keywords: ["theme", "colors"], run: () => setAppearance({ mode: a.mode === "dark" ? "light" : "dark" }) },
    { id: "animations", title: a.animations ? "Animations off" : "Animations on", group: "Appearance", keywords: ["motion", "reduce"], run: () => setAppearance({ animations: !a.animations }) },
  );
  for (const s of SETTINGS_SECTIONS) {
    const [title, keywords] = SECTION_TITLES[s];
    list.push({ id: `settings-${s}`, title, group: "Settings", keywords, run: () => openSettings(s) });
  }
  return list;
}

/** The last row for any query: search YouTube Music for it. */
export const searchCommand = (query: string): Command => ({
  id: "search",
  title: `Search for “${query.trim()}”`,
  group: "Search",
  run: () => {
    useUi.getState().setNowPlaying(false);
    openSearch(query);
  },
});
