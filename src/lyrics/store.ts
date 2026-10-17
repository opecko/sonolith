import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { Track } from "../api/types";
import { getLyrics } from "../api/ytm";
import { usePlayer } from "../stores/player";
import { useProgress } from "../stores/progress";
import { useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";
import { chooseLyrics, type LyricLine, type LyricsData } from "./pick";
import { enabledProviders, type LyricsProviderId } from "./providers";

export type { LyricLine, LyricsData };

/** The backend's answer (src-tauri/src/lyrics/mod.rs). */
export interface LyricsResponse {
  provider: LyricsProviderId | null;
  lyrics: { synced: boolean; lines?: LyricLine[]; plain?: string } | null;
  source: string | null;
  cached: boolean;
  attempts: { provider: LyricsProviderId; status: string; ms: number; error?: string }[];
}

interface LyricsState {
  /** The track the state is about. */
  id: string | null;
  status: "idle" | "loading" | "done";
  data: LyricsData | null;
}

export const useLyrics = create<LyricsState>(() => ({ id: null, status: "idle", data: null }));

export function lyricsRequest(t: Track, providers: LyricsProviderId[], debug = false) {
  const duration = t.durationSec ?? (useProgress.getState().duration || undefined);
  return {
    args: { videoId: t.id, title: t.title, artist: t.artists.join(", ") || t.subtitle, album: t.album?.title ?? null, durationSec: duration ?? null, providers, debug },
  };
}

const toData = (r: LyricsResponse): LyricsData | null =>
  r.provider && r.lyrics
    ? { provider: r.provider, synced: r.lyrics.synced, lines: r.lyrics.lines ?? [], plain: r.lyrics.plain, source: r.source ?? undefined }
    : null;

let gen = 0;
async function load(track: Track) {
  const mine = ++gen;
  const order = enabledProviders(useSettings.getState().lyricsProviders);
  useLyrics.setState({ id: track.id, status: "loading", data: null });
  const fromProviders = order.length
    ? await invoke<LyricsResponse>("lyrics_get", lyricsRequest(track, order)).then(toData, () => null)
    : null;
  if (mine !== gen) return;
  let youtube: LyricsData | null = null;
  if (!fromProviders?.synced && order.includes("youtube")) {
    // /next for this track may still be on its way: its lyrics tab, when there is one.
    const ref = await waitForWatch(track.id);
    if (ref) youtube = await getLyrics(ref).then((l) => (l?.text ? { provider: "youtube" as const, synced: false, lines: [], plain: l.text, source: l.source?.replace(/^Source:\s*/, "") } : null), () => null);
  }
  if (mine !== gen) return;
  useLyrics.setState({ id: track.id, status: "done", data: chooseLyrics(fromProviders, youtube, order) });
}

function waitForWatch(id: string): Promise<import("../api/types").BrowseRef | undefined> {
  const now = usePlayer.getState().watch;
  if (now?.videoId === id) return Promise.resolve(now.lyrics);
  return new Promise((resolve) => {
    const stop = usePlayer.subscribe((s) => {
      if (s.queue[s.index]?.id !== id) return done(undefined);
      if (s.watch?.videoId === id) done(s.watch.lyrics);
    });
    const timer = setTimeout(() => done(undefined), 8000);
    function done(v: import("../api/types").BrowseRef | undefined) {
      stop();
      clearTimeout(timer);
      resolve(v);
    }
  });
}

/**
 * Lyrics follow the playing track while Now Playing is open and the window is visible (nothing is fetched for a
 * hidden window or a closed Now Playing); podcast episodes have none. Changing the providers fetches again.
 */
function ensure(force = false) {
  const track = usePlayer.getState().queue[usePlayer.getState().index];
  if (!track) return;
  if (track.podcast) {
    if (useLyrics.getState().id !== track.id) useLyrics.setState({ id: track.id, status: "done", data: null });
    return;
  }
  if (!useUi.getState().nowPlaying || document.hidden) return;
  const s = useLyrics.getState();
  if (!force && s.id === track.id && s.status !== "idle") return;
  void load(track);
}

let started = false;
export function initLyrics() {
  if (started) return;
  started = true;
  let lastId: string | undefined;
  usePlayer.subscribe((s) => {
    const id = s.queue[s.index]?.id;
    if (id === lastId) return;
    lastId = id;
    ensure();
  });
  useUi.subscribe((s, p) => s.nowPlaying !== p.nowPlaying && ensure());
  useSettings.subscribe((s, p) => {
    if (s.lyricsProviders === p.lyricsProviders) return;
    // Another order or set of providers: fetched again (now, or when Now Playing next opens).
    useLyrics.setState({ status: "idle" });
    ensure(true);
  });
  document.addEventListener("visibilitychange", () => ensure());
}
