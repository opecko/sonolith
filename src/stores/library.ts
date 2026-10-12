import { create } from "zustand";
import type { Item } from "../api/types";
import { createPlaylist, getLibrary } from "../api/ytm";
import { invalidate } from "../hooks/useData";

interface LibraryState {
  playlists: Item[] | null;
  error: string | null;
  load: () => Promise<void>;
  create: (title: string) => Promise<string | undefined>;
  /** A playlist's contents changed (song added or removed): its track count in the list is stale. */
  changed: () => void;
}

let inflight: Promise<void> | null = null;

/**
 * Playlists created here that the library listing doesn't show yet: YouTube adds them to it with a delay, so
 * until then they're kept at the top (or dropped after a while, e.g. deleted elsewhere).
 */
const fresh = new Map<string, { item: Item; until: number }>();
const FRESH_MS = 2 * 60_000;

/** YouTube's library listing lags behind edits; reload again a bit later until it has caught up. */
const LAGGED_RELOADS_MS = [2_500, 10_000];
let lagged: ReturnType<typeof setTimeout>[] = [];
function reloadLater() {
  lagged.forEach(clearTimeout);
  lagged = LAGGED_RELOADS_MS.map((ms) =>
    setTimeout(() => {
      void useLibrary.getState().load();
      invalidate("library:playlists"); // the Library page's Playlists tab
    }, ms),
  );
}

/** Sidebar playlist list (all pages of the Library "Playlists" tab). */
export const useLibrary = create<LibraryState>((set, get) => ({
  playlists: null,
  error: null,
  load: () =>
    (inflight ??= (async () => {
      try {
        let page = await getLibrary("playlists");
        const all = [...page.items];
        for (let i = 0; page.loadMore && i < 20; i++) {
          page = await page.loadMore();
          all.push(...page.items);
        }
        const now = Date.now();
        for (const [id, f] of fresh) if (f.until < now || all.some((p) => p.id === id)) fresh.delete(id);
        set({ playlists: [...[...fresh.values()].map((f) => f.item), ...all], error: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        inflight = null;
      }
    })()),
  create: async (title) => {
    const id = await createPlaylist(title);
    if (id) {
      const item: Item = { type: "playlist", id, title, subtitle: "Playlist" };
      fresh.set(id, { item, until: Date.now() + FRESH_MS });
      set({ playlists: [item, ...(get().playlists ?? []).filter((p) => p.id !== id)] });
    }
    reloadLater();
    return id;
  },
  changed: () => reloadLater(),
}));
