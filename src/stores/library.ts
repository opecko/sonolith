import { create } from "zustand";
import type { Item } from "../api/types";
import { createPlaylist, deletePlaylist, getLibrary, renamePlaylist } from "../api/ytm";
import { invalidate } from "../hooks/useData";

interface LibraryState {
  playlists: Item[] | null;
  error: string | null;
  load: () => Promise<void>;
  create: (title: string, opts?: Parameters<typeof createPlaylist>[1]) => Promise<string | undefined>;
  /** A playlist's contents changed (song added or removed): its track count in the list is stale. */
  changed: () => void;
  /** Deletes the playlist on YouTube Music and drops it from the list right away. */
  remove: (id: string) => Promise<void>;
  /** Renames the playlist on YouTube Music and shows the new title right away. */
  rename: (id: string, title: string) => Promise<void>;
  /** Shows a song added (+1) or removed (-1) in the playlist's track count before YouTube confirms it. */
  adjustCount: (id: string, delta: number) => void;
  /** Forgets the list (another account): the sidebar loads the new one. */
  reset: () => void;
}

let inflight: Promise<void> | null = null;
/** Bumped by reset so a load still running for the previous account doesn't write its list. */
let generation = 0;

/**
 * Playlists created here that the library listing doesn't show yet: YouTube adds them to it with a delay, so
 * until then they're kept at the top (or dropped after a while, e.g. deleted elsewhere).
 */
const fresh = new Map<string, { item: Item; until: number }>();
const FRESH_MS = 2 * 60_000;
/** Deleted here but possibly still in the lagging listing for a while: hidden until it's gone there. */
const deleted = new Map<string, number>();
/** Renamed here; the lagging listing may still have the old title for a while. */
const renamed = new Map<string, { title: string; until: number }>();

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
      const gen = generation;
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
        for (const [id, r] of renamed) if (r.until < now || all.some((p) => p.id === id && p.title === r.title)) renamed.delete(id);
        const listed = all.filter((p) => !deleted.has(p.id)).map((p) => (renamed.has(p.id) ? { ...p, title: renamed.get(p.id)!.title } : p));
        if (gen === generation) set({ playlists: [...[...fresh.values()].map((f) => f.item), ...listed], error: null });
      } catch (e) {
        if (gen === generation) set({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (gen === generation) inflight = null;
      }
    })()),
  create: async (title, opts) => {
    const id = await createPlaylist(title, opts);
    if (id) {
      const n = opts?.videoIds?.length ?? 0;
      const item: Item = { type: "playlist", id, title, subtitle: n ? countedSubtitle("Playlist", n) : "Playlist" };
      fresh.set(id, { item, until: Date.now() + FRESH_MS });
      set({ playlists: [item, ...(get().playlists ?? []).filter((p) => p.id !== id)] });
    }
    reloadLater();
    return id;
  },
  changed: () => reloadLater(),
  reset: () => {
    generation++;
    inflight = null;
    lagged.forEach(clearTimeout);
    lagged = [];
    fresh.clear();
    deleted.clear();
    renamed.clear();
    set({ playlists: null, error: null });
  },
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
  rename: async (id, title) => {
    await renamePlaylist(id, title);
    renamed.set(id, { title, until: Date.now() + FRESH_MS });
    const f = fresh.get(id);
    if (f) f.item = { ...f.item, title };
    set({ playlists: get().playlists?.map((p) => (p.id === id ? { ...p, title } : p)) ?? null });
    invalidate(`playlist:${id}`);
    reloadLater();
  },
}));
