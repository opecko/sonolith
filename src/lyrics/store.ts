import { Channel, invoke } from "@tauri-apps/api/core";
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

/** `lyrics_get`'s arguments; `onUpdate` gets the best answer so far each time a better one arrives. */
export function lyricsRequest(t: Track, providers: LyricsProviderId[], debug = false, onUpdate?: (r: LyricsResponse) => void) {
  const duration = t.durationSec ?? (useProgress.getState().duration || undefined);
  const channel = new Channel<LyricsResponse>();
  if (onUpdate) channel.onmessage = onUpdate;
  return {
    onUpdate: channel,
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
  // The best answer so far is shown at once and upgraded in place (line-synced → word-synced).
  const show = (d: LyricsData | null) => {
    if (mine !== gen || !d) return;
    const now = useLyrics.getState().data;
    if (now && now.provider === d.provider && now.synced === d.synced) return;
    useLyrics.setState({ status: "done", data: d });
  };
  // Providers match by length (Better Lyrics answers only with album and length): a track that doesn't carry its
  // length waits for the audio's, or it would be asked without one and lose its best lyrics.
  if (order.length && !track.durationSec) await waitForDuration(track.id);
  if (mine !== gen) return;
  const fromProviders = order.length
    ? await invoke<LyricsResponse>("lyrics_get", lyricsRequest(track, order, false, (r) => r.lyrics?.synced && show(toData(r)))).then(toData, () => null)
    : null;
  if (mine !== gen) return;
  let youtube: LyricsData | null = null;
  if (!fromProviders?.synced && order.includes("youtube")) {
    // /next for this track may still be on its way: its lyrics tab, when there is one.
    const ref = await waitForWatch(track.id);
    if (ref) youtube = await getLyrics(ref).then((l) => (l?.text ? { provider: "youtube" as const, synced: false, lines: [], plain: l.text, source: l.source?.replace(/^Source:\s*/, "") } : null), () => null);
  }
  if (mine !== gen) return;
  const chosen = chooseLyrics(fromProviders, youtube, order);
  const now = useLyrics.getState().data;
  // The same answer the view already shows: keep the object, nothing re-renders.
  if (now && chosen && now.provider === chosen.provider && now.synced === chosen.synced) useLyrics.setState({ status: "done" });
  else useLyrics.setState({ id: track.id, status: "done", data: chosen });
}

/** Until the playing audio's length is known (a few seconds at most; then the request goes without it). */
function waitForDuration(id: string): Promise<void> {
  if (useProgress.getState().duration > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const stopProgress = useProgress.subscribe((p) => p.duration > 0 && done());
    const stopPlayer = usePlayer.subscribe((s) => s.queue[s.index]?.id !== id && done());
    const timer = setTimeout(done, 4000);
    function done() {
      stopProgress();
      stopPlayer();
      clearTimeout(timer);
      resolve();
    }
  });
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
 * hidden window, a closed Now Playing or lyrics turned off); podcast episodes have none. Changing the providers fetches again.
 */
function ensure(force = false) {
  const track = usePlayer.getState().queue[usePlayer.getState().index];
  if (!track) return;
  if (track.podcast) {
    if (useLyrics.getState().id !== track.id) useLyrics.setState({ id: track.id, status: "done", data: null });
    return;
  }
  if (!useUi.getState().nowPlaying || document.hidden || !useSettings.getState().lyricsEnabled) return;
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
    // Turned back on: fetched now (or when Now Playing next opens).
    if (s.lyricsEnabled !== p.lyricsEnabled) return void (s.lyricsEnabled && ensure());
    if (s.lyricsProviders === p.lyricsProviders) return;
    // Another order or set of providers: fetched again (now, or when Now Playing next opens).
    useLyrics.setState({ status: "idle" });
    ensure(true);
  });
  document.addEventListener("visibilitychange", () => ensure());
}
