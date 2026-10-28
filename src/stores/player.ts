import { create } from "zustand";
import { errorText } from "../api/errors";
import { maxresUrl, mediaArtwork } from "../api/art";
import type { NextResult } from "../api/queue";
import { getStreamUrl, logPlayback, prefetchStream, probeStream, UnsupportedCodecError, viaProxy, type Stream } from "../api/stream";
import type { QueueChip, Rating, Track } from "../api/types";
import type { RadioSource } from "../api/queue";
import { getChipTracks, getPodcastShow, getWatch, rate, startRadio } from "../api/ytm";
import { autoplayTrigger, dedupeAutoplay, pushHistory } from "./autoplay";
import { savedResume, savePosition } from "./episodeProgress";
import { nextEpisode } from "./podcastQueue";
import { pipelineStuck, reconcileStatus, toggleAction } from "./playState";
import { bindPlayhead } from "../playback/playhead";
import { useProgress } from "./progress";
import { append, dedupe, insertNext, reorder } from "./queueOps";
import { makeSnapshot, readSnapshot, SNAPSHOT_KEY } from "./queueSnapshot";
import { nativeMpris } from "./platform";
import { useSettings } from "./settings";
import { useToast } from "./toast";

export type Repeat = "off" | "all" | "one";
type Status = "idle" | "loading" | "playing" | "paused" | "error";

/** What the queue was started from; drives /next (chips) and "load more". */
export interface QueueContext {
  playlistId?: string;
  params?: string;
  title?: string;
  /** Radio/playlist continuation for appending more tracks. */
  continuation?: string;
  /** The continuation belongs to autoplay: tracks it appends are marked as autoplay. */
  autoplay?: boolean;
}

interface PlayerState {
  queue: Track[];
  index: number;
  status: Status;
  error: string | null;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  /** Thumbs ratings known/changed this session, by video id (falls back to Track.rating). */
  ratings: Record<string, Rating>;
  context: QueueContext;
  /** Raw /next info for the current track (header, related/lyrics tabs, automix seed). */
  watch: (NextResult & { videoId: string }) | null;
  /** While /next for a new track is on its way: the track before had Related, so Now Playing keeps offering it. */
  relatedHeld: boolean;
  /** The current track is a live stream (a live station): no length, no seeking; the UI shows "Live". */
  live: boolean;
  chips: QueueChip[];
  activeChipId: string | null;
  chipLoading: boolean;
  playRadio: (track: Track) => void;
  /** Replaces the queue with a radio once it is ready; the current track keeps playing until then. */
  startRadio: (source: RadioSource, label?: string) => Promise<void>;
  radioPending: string | null;
  /** One track or a whole album/playlist, right after the current one. */
  playNext: (tracks: Track | Track[]) => void;
  /** One track or a whole album/playlist, at the end of the queue. */
  addToQueue: (tracks: Track | Track[]) => void;
  removeAt: (index: number) => void;
  /** Removes everything but the current track (and stops the queue's source from refilling it); playback goes on. */
  clearQueue: () => void;
  /** Drag & drop reorder; playback is untouched, `index` follows the playing track. */
  moveTrack: (from: number, to: number) => void;
  /** Applies the autoplay setting: OFF drops pending autoplay tracks, ON may fetch immediately. */
  setAutoplay: (on: boolean) => void;
  playIndex: (index: number) => void;
  selectChip: (id: string) => void;
  /** `startAt` (seconds) starts the first track there instead of the beginning (or an episode's saved spot). */
  playQueue: (tracks: Track[], index?: number, context?: QueueContext, startAt?: number) => void;
  togglePlay: () => void;
  /** Play or pause outright (MPRIS / media session Play and Pause), whatever the shown status says. */
  setPlaying: (on: boolean) => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  /** Relative seek (podcast −10 / +30 s). */
  skipBy: (sec: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  /** Optimistically rates a track; reverts with a toast if the request fails. */
  rateTrack: (track: Track, rating: Rating) => void;
  toggleLike: () => void;
  toggleDislike: () => void;
}

const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
// The GStreamer hint only applies to Linux (WebKitGTK); on Windows WebView2 decodes everything we request itself.
const DECODE_HINT = /Linux/.test(navigator.userAgent)
  ? "WebKitGTK could not decode this stream. Install gstreamer1.0-plugins-good, gstreamer1.0-plugins-bad and gstreamer1.0-libav."
  : "This song couldn't be played. Try again in a moment.";

const audio = new Audio();
bindPlayhead(audio);

/** Where playback really is, in seconds; unlike useProgress it keeps moving while the window is hidden. */
export const playbackTime = () => audio.currentTime;
const tickListeners = new Set<() => void>();
/** Runs on every timeupdate (a few times a second), hidden window included, for bookkeeping like history. */
export function onPlaybackTick(fn: () => void): () => void {
  tickListeners.add(fn);
  return () => tickListeners.delete(fn);
}
audio.preload = "auto";

/** Original (unshuffled) sequence, used to restore order when shuffle is turned off. */
let unshuffled: Track[] = [];
let gen = 0;
let retries = 0;
let current: Stream | null = null;
let prefetchedFor = -1;
let watchGen = 0;
let chipLoadGen = 0;
let queueGen = 0;
/** Pending "Start radio" request; any newer queue action cancels it. */
let radioReq = 0;
let loadingMore: Promise<boolean> | null = null;
const LOAD_MORE_AT = 3;
/** A live stream paused at least this long jumps back to live when it resumes. */
const LIVE_BEHIND_S = 10;
const AUTOPLAY_RETRY_MS = 5000;
let history: string[] = [];
let autoplayInflight: Promise<void> | null = null;
const autoplaySeeds = new Set<string>();
/** Per-chip upcoming tracks for the current track; reset when the track changes. */
let chipCache = new Map<string, { tracks: Track[]; continuation?: string }>();

const readVolume = () => {
  try {
    const v = Number(localStorage.getItem("volume"));
    return localStorage.getItem("volume") !== null && v >= 0 && v <= 1 ? v : 0.8;
  } catch {
    return 0.8;
  }
};

export function shuffleTracks<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const message = errorText;

/** Last session's queue (see queueSnapshot.ts); restored as "idle": shown and ready, nothing plays until Play. */
const saved = (() => {
  try {
    return readSnapshot(localStorage.getItem(SNAPSHOT_KEY));
  } catch {
    return null;
  }
})();

export const usePlayer = create<PlayerState>((set, get) => {
  audio.volume = readVolume();
  if (saved) {
    unshuffled = saved.queue;
    useProgress.setState({ position: 0, duration: saved.queue[saved.index].durationSec ?? 0 });
  }

  // The queue array is always in play order; shuffle physically reorders what comes after the current track.
  const peekNext = (): number | null => {
    const { index, queue, repeat } = get();
    if (index + 1 < queue.length) return index + 1;
    return repeat === "all" && queue.length > 0 ? 0 : null;
  };

  function fail(text: string) {
    const track = get().queue[get().index];
    logPlayback(`${track?.id ?? "?"} ${text}`);
    set({ status: "error", error: text });
  }

  /** Resolves (or reuses) a stream and starts it. `proxy` routes it through the local Rust proxy. */
  async function load(index: number, resumeAt = 0, opts: { alternate?: boolean; proxy?: boolean; reuse?: Stream } = {}) {
    const track = get().queue[index];
    if (!track) return;
    const mine = ++gen;
    set({ index, status: "loading", error: null, live: !!opts.reuse?.live });
    useProgress.setState({ position: resumeAt, duration: track.durationSec ?? 0 });
    updateMediaSession(track);
    try {
      let stream = opts.reuse ?? (await getStreamUrl(track.id, { alternate: opts.alternate }));
      if (opts.proxy && !stream.proxied) stream = await viaProxy(stream);
      if (mine !== gen) return;
      current = stream;
      if (!!stream.live !== get().live) set({ live: !!stream.live });
      audio.src = stream.url;
      applyRate(); // a new src resets playbackRate
      if (resumeAt > 0) {
        audio.addEventListener("loadedmetadata", () => (audio.currentTime = resumeAt), { once: true });
      }
      await audio.play();
    } catch (e) {
      if (mine !== gen) return;
      // play() rejections after a src error are handled by the "error" listener.
      if (e instanceof DOMException && audio.error) return;
      fail(e instanceof UnsupportedCodecError ? e.message : `Playback failed: ${message(e)}`);
    }
  }

  function start(index: number, startAt?: number) {
    retries = 0;
    stuckRecoveries = 0;
    pausedAt = null;
    prefetchedFor = -1;
    // Episodes continue where they were left (stores/episodeProgress).
    const t = get().queue[index];
    void load(index, startAt ?? (t?.podcast ? savedResume(t.id) : 0));
    const id = get().queue[index]?.id;
    if (id) history = pushHistory(history, id);
    void refreshWatch();
    if (get().queue.length - 1 - index <= LOAD_MORE_AT) void loadMore().then((added) => !added && maybeAutoplay());
    maybeAutoplay();
  }

  /** Keeps music going after a lone song or at the end of a finite queue (see autoplay.ts for the rules). */
  function maybeAutoplay() {
    const { queue, index, repeat, context, watch } = get();
    const current = queue[index];
    const kind = autoplayTrigger({
      enabled: useSettings.getState().autoplay,
      repeat,
      queueLength: queue.length,
      index,
      hasMoreSource: !!context.continuation || (queue.length === 1 && !!context.playlistId),
      podcast: !!current?.podcast,
    });
    if (!kind || !current || autoplayInflight) return;
    // Seed from the last track; for finite lists prefer YTM's own automix endpoint once /next has arrived.
    const last = queue[queue.length - 1];
    const watchReady = watch?.videoId === current.id;
    if (kind === "ending" && !watchReady) return; // refreshWatch calls back in
    const automix = kind === "ending" ? watch?.automix : undefined;
    const seedKey = automix?.playlistId ?? last.id;
    if (autoplaySeeds.has(seedKey)) return;
    autoplaySeeds.add(seedKey);
    autoplayInflight = runAutoplay(automix ?? { videoId: last.id, playlistId: `RDAMVM${last.id}`, params: "wAEB" }, false).finally(() => {
      autoplayInflight = null;
    });
  }

  async function runAutoplay(args: { videoId?: string; playlistId?: string; params?: string }, retried: boolean): Promise<void> {
    const mine = queueGen;
    try {
      const r = await getWatch(args);
      if (mine !== queueGen || !useSettings.getState().autoplay) return;
      const fresh = dedupeAutoplay(r.tracks, get().queue, history);
      if (fresh.length) set({ queue: [...get().queue, ...fresh] });
      unshuffled = [...unshuffled, ...fresh];
      const ctx = get().context;
      set({ context: { ...ctx, playlistId: ctx.playlistId ?? r.playlistId, continuation: r.continuation, autoplay: true } });
    } catch (e) {
      if (mine !== queueGen) return;
      if (!retried) {
        await new Promise((r) => setTimeout(r, AUTOPLAY_RETRY_MS));
        if (mine === queueGen) return runAutoplay(args, true);
        return;
      }
      useToast.getState().show(`Autoplay stopped: ${message(e)}`, "info");
    }
  }

  /** One raw /next per track change: chips (shown only when the response has them), header, tabs. */
  async function refreshWatch() {
    const { queue, index, context } = get();
    const track = queue[index];
    const mine = ++watchGen;
    chipCache = new Map();
    if (!track) return set({ watch: null, relatedHeld: false, chips: [], activeChipId: null });
    const before = get().watch;
    // Skipping on before /next answered keeps holding what the last answered track had.
    if (before?.videoId !== track.id) set({ watch: null, relatedHeld: !!before?.related || (!before && get().relatedHeld) });
    try {
      const w = await getWatch({ videoId: track.id, playlistId: context.playlistId, params: context.params });
      if (mine !== watchGen) return;
      const activeLabel = get().chips.find((c) => c.id === get().activeChipId)?.label;
      const kept = w.chips.find((c) => c.label === activeLabel) ?? w.chips.find((c) => c.selected) ?? null;
      set({ watch: { ...w, videoId: track.id }, relatedHeld: false, chips: w.chips, activeChipId: kept?.id ?? null });
      // Some lists (search top-result songs, artist cards) omit the artist or album, and typed page parsers don't
      // know about podcast episodes; /next's own entry for the track has all of it.
      const full = w.tracks.find((t) => t.id === track.id);
      const patch: Partial<Track> = {};
      if (full) {
        if (!track.artists.length && full.artists.length) patch.artists = full.artists;
        if (!track.artistIds?.some(Boolean) && full.artistIds?.some(Boolean) && (patch.artists ?? track.artists).join() === full.artists.join()) patch.artistIds = full.artistIds;
        if (!track.album && full.album) patch.album = full.album;
        if (full.podcast && !track.podcast) patch.podcast = true;
        if (full.explicit && !track.explicit) patch.explicit = true;
        if (full.video && !track.video) patch.video = true;
      }
      if (Object.keys(patch).length) {
        const q = [...get().queue];
        if (q[get().index]?.id === track.id) {
          q[get().index] = { ...q[get().index], ...patch };
          set({ queue: q });
        }
      }
      // Server rating for the current track, unless the user changed it this session.
      if (w.rating && get().ratings[track.id] === undefined) set((st) => ({ ratings: { ...st.ratings, [track.id]: w.rating! } }));
      // Long playlists queued from a partially loaded page keep going via the panel's own continuation.
      const ctx = get().context;
      if (!ctx.continuation && w.continuation && w.playlistId && w.playlistId === ctx.playlistId)
        set({ context: { ...ctx, continuation: w.continuation } });
      maybeAutoplay();
    } catch (e) {
      if (mine !== watchGen) return;
      set({ watch: null, relatedHeld: false, chips: [], activeChipId: null });
      console.warn("watch-next unavailable:", e);
    }
  }

  /** Appends tracks not already queued; returns how many were added. */
  function appendTracks(tracks: Track[]): number {
    const { queue } = get();
    const known = new Set(queue.map((t) => t.id));
    const auto = get().context.autoplay;
    const fresh = tracks
      .filter((t) => !known.has(t.id) && !(auto && history.includes(t.id)) && (known.add(t.id), true))
      .map((t) => (auto ? { ...t, source: "autoplay" as const } : t));
    if (!fresh.length) return 0;
    unshuffled = [...unshuffled, ...fresh];
    set({ queue: [...queue, ...(get().shuffle ? shuffleTracks(fresh) : fresh)] });
    return fresh.length;
  }

  // Keeps what was already played plus the current track; swaps only what comes after. Never touches audio.
  function replaceUpcoming(tracks: Track[]) {
    const { queue, index, shuffle } = get();
    const played = queue.slice(0, index + 1);
    const seen = new Set(played.map((t) => t.id));
    const fresh = tracks.filter((t) => !seen.has(t.id) && (seen.add(t.id), true));
    unshuffled = [...played, ...fresh];
    set({ queue: [...played, ...(shuffle ? shuffleTracks(fresh) : fresh)] });
  }

  async function advance(auto: boolean) {
    const { index, repeat } = get();
    if (auto && repeat === "one") return start(index);
    let target = peekNext();
    if (target === null && (await loadMore())) target = peekNext();
    if (target === null && autoplayInflight) {
      await autoplayInflight; // autoplay fetch for the end of the queue is still running
      target = peekNext();
    }
    if (target === null && auto && (await queueNextEpisode())) target = peekNext();
    if (target !== null) start(target);
    else if (auto) set({ status: "paused" });
  }

  /**
   * An episode ended with nothing after it: with "After an episode: Play next episode", the show's next (newer)
   * episode joins the queue. Never a music radio (autoplay skips episodes).
   */
  async function queueNextEpisode(): Promise<boolean> {
    const cur = get().queue[get().index];
    if (!cur?.podcast || !cur.show || useSettings.getState().afterEpisode !== "next") return false;
    try {
      const show = await getPodcastShow(cur.show.id);
      if (get().queue[get().index]?.id !== cur.id) return false;
      const next = nextEpisode(show.episodes, cur.id);
      if (!next) return false;
      return appendTracks([{ ...next, show: cur.show }]) > 0;
    } catch (e) {
      console.warn("next episode failed:", e);
      return false;
    }
  }

  /** Appends the next page of the queue's continuation (radio / long playlist). */
  function loadMore(): Promise<boolean> {
    const { continuation } = get().context;
    if (!continuation) return Promise.resolve(false);
    const mine = queueGen;
    return (loadingMore ??= (async () => {
      try {
        const r = await getWatch({ continuation });
        if (mine !== queueGen || get().context.continuation !== continuation) return false;
        set({ context: { ...get().context, continuation: r.continuation } });
        return appendTracks(r.tracks) > 0;
      } catch (e) {
        console.warn("queue continuation failed:", e);
        return false;
      } finally {
        loadingMore = null;
      }
    })());
  }

  audio.addEventListener("playing", () => set({ status: "playing" }));
  // A live stream resumed after a longer pause would play on from where it stopped; like YouTube Music, go back to
  // live. It's one endless stream from the proxy (no seeking), so that's a new connection, which starts at the edge.
  let livePausedAt = 0;
  audio.addEventListener("pause", () => (livePausedAt = current?.live ? Date.now() : 0));
  audio.addEventListener("play", () => {
    if (!current?.live || !livePausedAt || Date.now() - livePausedAt < LIVE_BEHIND_S * 1000) return;
    livePausedAt = 0;
    audio.src = current.url;
    void audio.play().catch(() => {});
  });
  // An episode's position is saved every few seconds while it plays, and when it pauses or ends.
  let episodeSavedAt = 0;
  function saveEpisode(force: boolean) {
    const t = get().queue[get().index];
    if (!t?.podcast || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const now = Date.now();
    if (!force && now - episodeSavedAt < 5000) return;
    episodeSavedAt = now;
    savePosition(t.id, audio.ended ? audio.duration : audio.currentTime, audio.duration);
  }
  audio.addEventListener("pause", () => {
    saveEpisode(true);
    pausedAt = audio.currentTime;
    if (!audio.ended && get().status === "playing") set({ status: "paused" });
  });
  audio.addEventListener("play", () => {
    pausedAt = null;
    syncStatus();
  });
  // Pause / play / seek events can come late or out of order (WebKitGTK); the element is the truth. Checked on every
  // playback event, so a status that drifted (shown paused while it plays) comes right within a fraction of a second.
  function syncStatus() {
    const next = reconcileStatus(get().status, audio);
    if (next) set({ status: next });
  }
  // Where a paused element stood; time moving away from it means the media pipeline didn't actually stop.
  let pausedAt: number | null = null;
  let stuckRecoveries = 0;
  function checkStuck() {
    if (pausedAt === null || audio.seeking || !pipelineStuck(audio, audio.currentTime - pausedAt)) return;
    const t = audio.currentTime;
    const id = get().queue[get().index]?.id ?? "?";
    logPlayback(`${id} paused element kept playing (moved ${(t - pausedAt).toFixed(1)} s); reloading the source at ${t.toFixed(1)} s`);
    pausedAt = null;
    // A fresh pipeline on the same stream, at the same spot, paused (as the user asked). Once per track: if even
    // that keeps playing, the status at least shows the truth (syncStatus).
    if (stuckRecoveries++ > 0 || !audio.currentSrc) return;
    audio.addEventListener("loadedmetadata", () => (audio.currentTime = t), { once: true });
    audio.src = audio.currentSrc;
    set({ status: "paused" });
  }
  audio.addEventListener("seeking", () => {
    if (audio.paused) pausedAt = audio.currentTime;
  });
  audio.addEventListener("durationchange", () => {
    if (Number.isFinite(audio.duration)) useProgress.setState({ duration: audio.duration });
  });
  // The clock only changes once per displayed second and not at all while the window is hidden:
  // each update repaints the player bar, which is costly on software-rendered WebKitGTK.
  let shownSecond = -1;
  const pushClock = () => {
    const sec = Math.floor(audio.currentTime);
    if (sec === shownSecond) return;
    shownSecond = sec;
    useProgress.setState({ position: sec });
  };
  document.addEventListener("visibilitychange", () => !document.hidden && pushClock());
  audio.addEventListener("seeked", () => {
    shownSecond = -1;
    pushClock();
    syncStatus();
  });
  audio.addEventListener("timeupdate", () => {
    if (!document.hidden) pushClock();
    syncStatus();
    checkStuck();
    saveEpisode(false);
    for (const fn of tickListeners) fn();
    const { index } = get();
    if (prefetchedFor !== index && audio.currentTime > Math.min(30, audio.duration / 2 || 30)) {
      prefetchedFor = index;
      const next = peekNext();
      const track = next === null ? null : get().queue[next];
      if (track) prefetchStream(track.id);
    }
  });
  audio.addEventListener("ended", () => {
    saveEpisode(true);
    void advance(true);
  });
  // Recovery ladder for <audio> errors: same URL via local proxy → fresh URL from the other resolver (proxied).
  audio.addEventListener("error", () => {
    const err = audio.error;
    const code = err?.code;
    const { index } = get();
    const resumeAt = audio.currentTime;
    const track = get().queue[index];
    const failed = current;
    logPlayback(`${track?.id ?? "?"} MediaError code=${code} msg=${err?.message ?? ""} source=${failed?.source} codec=${failed?.codec} itag=${failed?.itag ?? "-"} proxied=${!!failed?.proxied} retry=${retries}`);
    // First failure of a stream: record what the server actually sends for it.
    if (failed && !failed.proxied) void probeStream(failed).then((p) => logPlayback(`${track?.id ?? "?"} probe ${failed.source}: ${p}`));
    const recoverable = code === MEDIA_ERR_SRC_NOT_SUPPORTED || code === MEDIA_ERR_NETWORK;
    if (recoverable && retries === 0 && current && !current.proxied) {
      retries++;
      void load(index, resumeAt, { reuse: current, proxy: true });
    } else if (recoverable && retries <= 1) {
      retries = 2;
      void load(index, resumeAt, { alternate: current?.source !== "yt-dlp", proxy: true });
    } else {
      const detail = `MediaError ${code ?? "?"}${err?.message ? `: ${err.message}` : ""}`;
      fail(code === MEDIA_ERR_SRC_NOT_SUPPORTED ? `${DECODE_HINT} (${detail})` : `Audio playback error (${detail})`);
    }
  });

  return {
    queue: saved?.queue ?? [],
    index: saved?.index ?? -1,
    status: "idle",
    error: null,
    volume: audio.volume,
    muted: false,
    shuffle: saved?.shuffle ?? false,
    repeat: saved?.repeat ?? "off",
    ratings: {},
    context: saved?.context ?? {},
    watch: null,
    relatedHeld: false,
    live: false,
    chips: saved?.chips ?? [],
    activeChipId: saved?.activeChipId ?? null,
    chipLoading: false,

    playQueue: (tracks, index = 0, context = {}, startAt) => {
      if (!tracks.length) return;
      queueGen++;
      radioReq++; // a queue the user picked wins over a radio still loading
      autoplaySeeds.clear();
      unshuffled = tracks;
      const queue = get().shuffle ? [tracks[index], ...shuffleTracks(tracks.filter((_, i) => i !== index))] : tracks;
      set({ queue, context, chips: [], activeChipId: null, radioPending: null });
      start(get().shuffle ? 0 : index, startAt);
    },
    playRadio: (track) => {
      const mine = ++queueGen;
      const playlistId = `RDAMVM${track.id}`;
      autoplaySeeds.clear();
      unshuffled = [track];
      set({ queue: [track], context: { playlistId }, chips: [], activeChipId: null });
      start(0);
      getWatch({ videoId: track.id, playlistId }).then(
        (r) => {
          if (mine !== queueGen || get().queue[0]?.id !== track.id) return;
          set({ context: { playlistId: r.playlistId ?? playlistId, continuation: r.continuation, title: r.header?.subtitle } });
          appendTracks(r.tracks);
        },
        (e) => mine === queueGen && useToast.getState().show(`Could not load radio: ${message(e)}`),
      );
    },
    radioPending: null,
    startRadio: async (source, label) => {
      const mine = ++radioReq;
      set({ radioPending: label ?? source.type });
      try {
        const r = await startRadio(source);
        if (mine !== radioReq) return;
        set({ radioPending: null });
        get().playQueue(r.tracks, 0, { playlistId: r.playlistId, params: r.params, continuation: r.continuation, title: r.title });
      } catch (e) {
        if (mine !== radioReq) return;
        set({ radioPending: null });
        useToast.getState().show(`Could not start radio${label ? ` for "${label}"` : ""}: ${message(e)}`);
      }
    },
    playNext: (tracks) => {
      const { queue, index } = get();
      const list = Array.isArray(tracks) ? tracks : [tracks];
      if (!list.length) return;
      if (index < 0) return get().playQueue(dedupe(list));
      const r = insertNext(queue, index, list);
      set({ queue: r.queue });
      const known = new Set(unshuffled.map((t) => t.id));
      unshuffled = [...unshuffled, ...r.added.filter((t) => !known.has(t.id))];
    },
    addToQueue: (tracks) => {
      const { queue, index } = get();
      const list = Array.isArray(tracks) ? tracks : [tracks];
      if (!list.length) return;
      if (index < 0) return get().playQueue(dedupe(list));
      const r = append(queue, index, list);
      if (!r.added.length) return;
      set({ queue: r.queue });
      unshuffled = [...unshuffled, ...r.added];
    },
    setAutoplay: (on) => {
      useSettings.getState().set({ autoplay: on });
      if (on) return maybeAutoplay();
      const { queue, index, context } = get();
      const kept = queue.filter((t, i) => i <= index || t.source !== "autoplay");
      set({ queue: kept, context: context.autoplay ? { ...context, continuation: undefined, autoplay: false } : context });
    },
    moveTrack: (from, to) => {
      const r = reorder(get().queue, get().index, from, to);
      if (!r) return;
      if (!get().shuffle) unshuffled = r.queue;
      set(r);
    },
    removeAt: (i) => {
      const { queue, index } = get();
      if (i === index || !queue[i]) return;
      set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
    },
    clearQueue: () => {
      const { queue, index, context } = get();
      const current = queue[index];
      queueGen++; // drops autoplay and continuation pages still on their way
      autoplaySeeds.clear();
      unshuffled = current ? [current] : [];
      set({ queue: unshuffled, index: current ? 0 : -1, context: { ...context, continuation: undefined, autoplay: false } });
    },
    playIndex: (index) => {
      if (get().queue[index]) start(index);
    },
    // Replaces only what comes after the current track; playback is never restarted.
    selectChip: async (id) => {
      const { chips, activeChipId, queue, index, context } = get();
      const chip = chips.find((c) => c.id === id);
      const current = queue[index];
      if (!chip || !current || id === activeChipId) return;
      if (activeChipId && !chipCache.has(activeChipId)) {
        chipCache.set(activeChipId, { tracks: queue.slice(index + 1), continuation: context.continuation });
      }
      const mine = ++chipLoadGen;
      set({ chipLoading: true });
      try {
        const hit = chipCache.get(id) ?? (await getChipTracks(chip, current.id));
        if (mine !== chipLoadGen) return;
        if (get().queue[get().index]?.id !== current.id) return set({ chipLoading: false });
        chipCache.set(id, hit);
        replaceUpcoming(hit.tracks);
        set({ activeChipId: id, chipLoading: false, context: { ...get().context, continuation: hit.continuation } });
      } catch (e) {
        if (mine !== chipLoadGen) return;
        set({ chipLoading: false });
        useToast.getState().show(`Could not load "${chip.label}": ${message(e)}`);
      }
    },
    togglePlay: () => {
      switch (toggleAction(get().status, audio, get().index >= 0)) {
        case "play":
          // A rejection (interrupted by a pause, no source) leaves the element paused; the events say so.
          audio.play().catch(() => syncStatus());
          break;
        case "pause":
          audio.pause();
          break;
        case "restart":
          start(get().index);
      }
    },
    setPlaying: (on) => {
      if (on ? audio.paused || get().status === "error" || get().status === "idle" : !audio.paused) get().togglePlay();
    },
    next: () => void advance(false),
    prev: () => {
      const { index } = get();
      if (audio.currentTime > 3 || index <= 0) {
        audio.currentTime = 0;
        return;
      }
      start(index - 1);
    },
    skipBy: (sec) => {
      const d = Number.isFinite(audio.duration) ? audio.duration : Infinity;
      get().seek(Math.max(0, Math.min(d - 1, audio.currentTime + sec)));
    },
    seek: (sec) => {
      audio.currentTime = sec;
      useProgress.setState({ position: sec });
    },
    toggleMute: () => {
      audio.muted = !audio.muted;
      set({ muted: audio.muted });
    },
    setVolume: (v) => {
      audio.volume = v;
      if (audio.muted && v > 0) audio.muted = false;
      set({ volume: v, muted: audio.muted });
      try {
        localStorage.setItem("volume", String(v));
      } catch {
        /* storage unavailable */
      }
    },
    toggleShuffle: () => {
      const shuffle = !get().shuffle;
      const { queue, index } = get();
      const head = queue.slice(0, index + 1);
      const rest = queue.slice(index + 1);
      if (shuffle) set({ shuffle, queue: [...head, ...shuffleTracks(rest)] });
      else {
        const rank = new Map(unshuffled.map((t, i) => [t.id, i]));
        const sorted = [...rest].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
        set({ shuffle, queue: [...head, ...sorted] });
      }
    },
    cycleRepeat: () => set((s) => ({ repeat: s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off" })),
    rateTrack: (track, rating) => {
      const was = ratingOf(get(), track);
      if (was === rating) return;
      set((st) => ({ ratings: { ...st.ratings, [track.id]: rating } }));
      // Like YouTube Music: disliking the song that's playing skips it.
      if (rating === "DISLIKE" && get().queue[get().index]?.id === track.id) void advance(false);
      rate(track.id, rating).catch((e) => {
        set((st) => ({ ratings: { ...st.ratings, [track.id]: was } }));
        useToast.getState().show(`Could not update rating: ${message(e)}`);
      });
    },
    toggleLike: () => {
      const track = get().queue[get().index];
      if (track) get().rateTrack(track, ratingOf(get(), track) === "LIKE" ? "INDIFFERENT" : "LIKE");
    },
    toggleDislike: () => {
      const track = get().queue[get().index];
      if (track) get().rateTrack(track, ratingOf(get(), track) === "DISLIKE" ? "INDIFFERENT" : "DISLIKE");
    },
  };
});

/** Effective rating of a track: session change, else what the server sent with the track. */
export function ratingOf(state: { ratings: Record<string, Rating> }, track: Track): Rating {
  return state.ratings[track.id] ?? track.rating ?? "INDIFFERENT";
}

/** The playing <audio> element (the video in Now Playing follows it, components/TrackVideo.tsx). */
export const getAudio = () => audio;
/** The stream loaded into it (the visualizer plays its own silent copy of it). */
export const currentStream = () => current;

/** Podcast episodes play at the chosen speed (pitch preserved); music always at 1×. */
function applyRate() {
  const s = usePlayer.getState();
  const rate = s.queue[s.index]?.podcast ? useSettings.getState().podcastSpeed : 1;
  audio.defaultPlaybackRate = rate;
  if (audio.playbackRate !== rate) audio.playbackRate = rate;
}
usePlayer.subscribe((s, prev) => {
  if (s.queue[s.index]?.podcast !== prev.queue[prev.index]?.podcast) applyRate();
});
useSettings.subscribe((s, prev) => s.podcastSpeed !== prev.podcastSpeed && applyRate());

// Persist the queue (debounced) whenever it, the position in it or its source changes.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
usePlayer.subscribe((s, prev) => {
  const changed = s.queue !== prev.queue || s.index !== prev.index || s.context !== prev.context || s.activeChipId !== prev.activeChipId
    || s.chips !== prev.chips || s.shuffle !== prev.shuffle || s.repeat !== prev.repeat;
  if (!changed) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const { queue, index, context, chips, activeChipId, shuffle, repeat } = usePlayer.getState();
    try {
      const snap = makeSnapshot({ queue, index, context, chips, activeChipId, shuffle, repeat });
      if (snap) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
      else localStorage.removeItem(SNAPSHOT_KEY);
    } catch {
      /* storage unavailable or full: the next session just starts empty */
    }
  }, 1000);
});

function updateMediaSession(track: Track) {
  if (nativeMpris || !("mediaSession" in navigator)) return;
  const set = (maxres: boolean) => {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artists.join(", "),
      album: track.album?.title ?? "",
      artwork: mediaArtwork(track.thumbnail, track.id, maxres),
    });
  };
  set(false);
  // Video thumbnails: upgrade to the 1280px frame once it's known to exist (404s for some videos).
  if (track.thumbnail && /i\.ytimg\.com\/vi\//.test(track.thumbnail)) {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      const s = usePlayer.getState();
      if (img.naturalWidth >= 640 && s.queue[s.index]?.id === track.id) set(true);
    };
    img.src = maxresUrl(track.id);
  }
}

if (nativeMpris && "mediaSession" in navigator) {
  // WebKitGTK exports its own MPRIS player for a playing <audio>, titled after the page when there's no metadata.
  // It only registers with a non-empty title, so an empty one keeps ours (src-tauri/src/mpris.rs) the only player.
  navigator.mediaSession.metadata = new MediaMetadata({ title: "" });
} else if ("mediaSession" in navigator) {
  const s = () => usePlayer.getState();
  navigator.mediaSession.setActionHandler("play", () => s().setPlaying(true));
  navigator.mediaSession.setActionHandler("pause", () => s().setPlaying(false));
  navigator.mediaSession.setActionHandler("nexttrack", () => s().next());
  navigator.mediaSession.setActionHandler("previoustrack", () => s().prev());
  navigator.mediaSession.setActionHandler("seekto", (d) => d.seekTime !== undefined && s().seek(d.seekTime));
}
