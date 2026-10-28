// Publishes the player, queue, account and lyrics state to the API server (src-tauri/src/api), which answers
// player.getState and sends events from it, and extrapolates the position itself (so nothing ticks here).
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../api/types";
import { useLyrics } from "../lyrics/store";
import { useAuth } from "../stores/auth";
import { useEpisodeProgress, resumeAt } from "../stores/episodeProgress";
import { getAudio, onAudioEvent, onPlaybackTick, playbackTime, ratingOf, usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { lyricsResult, mediaItem, type Ctx } from "./convert";
import type { EpisodeRate, PlayerState, QueueSummary } from "./schema.gen";
import { entryIds, playbackStatus, queueChangeReason, type QueueShape } from "./state";

/** What a caller with or without `library:read` sees of ratings and episode progress. */
export function ctx(library: boolean): Ctx {
  return {
    library,
    rating: (id) => usePlayer.getState().ratings[id],
    episode: (id) => {
      const e = useEpisodeProgress.getState().entries[id];
      return e && { played: e.played, resumeSec: resumeAt(e) };
    },
  };
}

const current = (): Track | undefined => usePlayer.getState().queue[usePlayer.getState().index];

let buffering = false;
let revision = 0;
let shape: QueueShape = { ids: [], index: -1, autoplay: [] };

function shapeNow(): QueueShape {
  const { queue, index } = usePlayer.getState();
  return { ids: queue.map((t) => t.id), index, autoplay: queue.map((t) => t.source === "autoplay") };
}

export const queueRevision = () => revision;
export const queueEntryIds = () => entryIds(usePlayer.getState().queue.map((t) => t.id));

export function canGoNext(): boolean {
  const { queue, index, repeat, context } = usePlayer.getState();
  return index >= 0 && (index + 1 < queue.length || (repeat === "all" && queue.length > 0) || !!context.continuation);
}

export function queueSummary(): QueueSummary {
  const { queue, index } = usePlayer.getState();
  return { revision, currentIndex: index >= 0 && queue[index] ? index : null, length: queue.length, autoplay: useSettings.getState().autoplay };
}

/** The full state, with library fields (the server hides them from apps without `library:read`). */
export function playerState(): PlayerState {
  const p = usePlayer.getState();
  const t = current();
  const audio = getAudio();
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : t?.durationSec;
  return {
    status: playbackStatus(p.status, !!t, buffering),
    item: t ? mediaItem({ ...t, rating: ratingOf(p, t) }, ctx(true)) : null,
    positionMs: t ? Math.max(0, Math.round(playbackTime() * 1000)) : 0,
    positionAt: Date.now(),
    durationMs: duration === undefined ? null : Math.round(duration * 1000),
    volume: Math.round(p.volume * 100),
    muted: p.muted,
    shuffle: p.shuffle,
    repeat: p.repeat,
    rate: t ? audio.playbackRate || 1 : 1,
    episodeRate: useSettings.getState().podcastSpeed as EpisodeRate,
    canGoNext: canGoNext(),
    canGoPrevious: !!t,
    queueIndex: queueSummary().currentIndex,
    queueLength: p.queue.length,
    autoplay: useSettings.getState().autoplay,
  };
}

let active = false;
let last: PlayerState | null = null;

const send = (kind: string, payload: unknown) => {
  if (active) invoke("api_publish", { kind, payload }).catch(() => {});
};

// One publish per burst of store updates (an action often sets several times in a row).
let playerDue = false;
function publishPlayer() {
  if (playerDue) return;
  playerDue = true;
  queueMicrotask(() => {
    playerDue = false;
    last = playerState();
    send("player", last);
  });
}

function publishLyrics() {
  const t = current();
  const l = useLyrics.getState();
  if (!t || l.id !== t.id || l.status !== "done") return;
  send("lyrics", lyricsResult(t.id, l.data));
}

/** Everything at once: when the API comes on, or the server asks after a reload. */
export function publishAll() {
  if (!active) return;
  publishPlayer();
  send("queue", { ...queueSummary(), reason: "other" });
  send("account", { signedIn: useAuth.getState().status === "signedIn" });
  publishLyrics();
}

export function setPublishing(on: boolean) {
  active = on;
  if (on) publishAll();
}

let started = false;
export function initPublishing() {
  if (started) return;
  started = true;
  shape = shapeNow();
  usePlayer.subscribe((s, p) => {
    const next = shapeNow();
    const reason = queueChangeReason(shape, next);
    shape = next;
    if (reason) {
      revision++;
      send("queue", { ...queueSummary(), reason });
    }
    if (reason || s.status !== p.status || s.volume !== p.volume || s.muted !== p.muted || s.shuffle !== p.shuffle || s.repeat !== p.repeat
      || s.context.continuation !== p.context.continuation || s.ratings !== p.ratings || s.queue[s.index] !== p.queue[p.index]) publishPlayer();
  });
  useSettings.subscribe((s, p) => {
    if (s.autoplay !== p.autoplay) send("queue", { ...queueSummary(), reason: "other" });
    if (s.autoplay !== p.autoplay || s.podcastSpeed !== p.podcastSpeed) publishPlayer();
  });
  useAuth.subscribe((s, p) => s.status !== p.status && send("account", { signedIn: s.status === "signedIn" }));
  useLyrics.subscribe(publishLyrics);
  // On whichever element plays (the player swaps two for crossfades).
  onAudioEvent("waiting", () => ((buffering = true), publishPlayer()));
  onAudioEvent("playing", () => ((buffering = false), publishPlayer()));
  for (const e of ["seeked", "ratechange", "durationchange", "pause"]) onAudioEvent(e, publishPlayer);
  // The server extrapolates from the last state; when playback drifts from that (stalls), it hears the truth.
  onPlaybackTick(() => {
    if (!active || !last || last.status !== "playing") return;
    const expected = last.positionMs + (Date.now() - last.positionAt) * last.rate;
    if (Math.abs(expected - playbackTime() * 1000) > 1000) publishPlayer();
  });
}
