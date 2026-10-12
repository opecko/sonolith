import { create } from "zustand";
import type { Item } from "../api/types";
import { createPlaylist, deletePlaylist, getLibrary } from "../api/ytm";
import { invalidate } from "../hooks/useData";

interface LibraryState {
  playlists: Item[] | null;
  error: string | null;
  load: () => Promise<void>;
  create: (title: string) => Promise<string | undefined>;
  /** A playlist's contents changed (song added or removed): its track count in the list is stale. */
  changed: () => void;
  /** Deletes the playlist on YouTube Music and drops it from the list right away. */
  remove: (id: string) => Promise<void>;
  /** Shows a song added (+1) or removed (-1) in the playlist's track count before YouTube confirms it. */
  adjustCount: (id: string, delta: number) => void;
}

let inflight: Promise<void> | null = null;

/**
 * Playlists created here that the library listing doesn't show yet: YouTube adds them to it with a delay, so
 * until then they're kept at the top (or dropped after a while, e.g. deleted elsewhere).
 */
const fresh = new Map<string, { item: Item; until: number }>();
const FRESH_MS = 2 * 60_000;
/** Deleted here but possibly still in the lagging listing for a while: hidden until it's gone there. */
const deleted = new Map<string, number>();

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

/** "7 tracks" → "8 tracks"; a just-created playlist ("Playlist") starts at 0. Other subtitles stay as they are. */
export function countedSubtitle(subtitle: string, delta: number): string {
  const m = /^(\d[\d,]*) tracks?$/.exec(subtitle);
  const before = m ? Number(m[1].replace(/,/g, "")) : subtitle === "Playlist" ? 0 : null;
  if (before === null) return subtitle;
  const n = Math.max(0, before + delta);
  return `${n.toLocaleString("en-US")} ${n === 1 ? "track" : "tracks"}`;
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
        for (const [id, until] of deleted) if (until < now || !all.some((p) => p.id === id)) deleted.delete(id);
        const listed = all.filter((p) => !deleted.has(p.id));
        set({ playlists: [...[...fresh.values()].map((f) => f.item), ...listed], error: null });
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
  adjustCount: (id, delta) =>
    set((s) => ({ playlists: s.playlists?.map((p) => (p.id === id ? { ...p, subtitle: countedSubtitle(p.subtitle, delta) } : p)) ?? null })),
  remove: async (id) => {
    await deletePlaylist(id);
    fresh.delete(id);
    deleted.set(id, Date.now() + FRESH_MS);
    set({ playlists: (get().playlists ?? []).filter((p) => p.id !== id) });
    invalidate(`playlist:${id}`);
    reloadLater();
  },
}));
