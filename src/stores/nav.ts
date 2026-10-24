import { create } from "zustand";

export type Route =
  | { name: "home" }
  | { name: "explore" }
  | { name: "library" }
  | { name: "settings" }
  | { name: "history" }
  | { name: "podcast" | "channel"; id: string }
  | { name: "search"; query: string }
  | { name: "playlist" | "album" | "artist"; id: string }
  | { name: "browse"; id: string; params?: string; title?: string };

interface NavState {
  route: Route;
  history: Route[];
  go: (route: Route) => void;
  back: () => void;
}

const same = (a: Route, b: Route) =>
  a.name === b.name &&
  ("id" in a && "id" in b ? a.id === b.id : true) &&
  ("query" in a && "query" in b ? a.query === b.query : true) &&
  ("params" in a || "params" in b ? (a as { params?: string }).params === (b as { params?: string }).params : true);

export const useNav = create<NavState>((set) => ({
  route: { name: "home" },
  history: [],
  go: (route) =>
    set((s) => (same(s.route, route) ? s : { route, history: [...s.history, s.route].slice(-50) })),
  back: () =>
    set((s) => {
      const prev = s.history[s.history.length - 1];
      return prev ? { route: prev, history: s.history.slice(0, -1) } : s;
    }),
}));

/** Settings categories (SettingsView's list, in this order). */
export const SETTINGS_SECTIONS = ["look", "colors", "nowplaying", "playback", "lyrics", "shortcuts", "discord", "apps", "system", "about"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Which category Settings shows (null: none picked yet; a wide window then shows the first, a narrow one the list)
 * and a setting to bring into view and highlight once it has rendered (`data-setting` on its row).
 */
export const useSettingsNav = create<{ section: SettingsSection | null; focus: string | null }>(() => ({ section: null, focus: null }));

export function openSettings(section?: SettingsSection, focus?: string) {
  useSettingsNav.setState({ section: section ?? null, focus: focus ?? null });
  useNav.getState().go({ name: "settings" });
}

export const openSearch = (query: string) => {
  const q = query.trim();
  if (q) useNav.getState().go({ name: "search", query: q });
};

export const openItem = (item: { type: string; id: string; podcast?: boolean; channel?: boolean }) => {
  const go = useNav.getState().go;
  if (item.type === "playlist" && item.podcast) go({ name: "podcast", id: item.id });
  else if (item.type === "artist" && item.channel) go({ name: "channel", id: item.id });
  else if (item.type === "album" || item.type === "playlist" || item.type === "artist") go({ name: item.type, id: item.id });
};
