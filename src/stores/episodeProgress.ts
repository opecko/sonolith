import { create } from "zustand";
import type { EpisodeInfo } from "../api/types";

/** Where an episode was left: position and length in seconds, played flag, when it was last saved (ms). */
export interface EpisodeEntry {
  pos: number;
  dur: number;
  played: boolean;
  at: number;
}
export type EpisodeMap = Record<string, EpisodeEntry>;

const KEY = "episode-progress-v1";
/** Kept for the most recently listened episodes only. */
export const MAX_ENTRIES = 300;
/** This close to the end counts as played (outros, ads). */
const END_SLACK = 30;

/** Records a position; within the last 30 s (or 97 %) the episode counts as played. Oldest entries drop off. */
export function record(map: EpisodeMap, id: string, pos: number, dur: number, now: number): EpisodeMap {
  if (!id || !(dur > 0) || !(pos >= 0)) return map;
  const played = pos >= dur - END_SLACK || pos / dur >= 0.97 || (map[id]?.played === true && pos < 5);
  const next = { ...map, [id]: { pos: Math.min(pos, dur), dur, played, at: now } };
  const ids = Object.keys(next);
  if (ids.length <= MAX_ENTRIES) return next;
  ids.sort((a, b) => next[b].at - next[a].at);
  return Object.fromEntries(ids.slice(0, MAX_ENTRIES).map((k) => [k, next[k]]));
}

/** Marks played / unplayed by hand; unplayed starts over from the beginning. */
export function mark(map: EpisodeMap, id: string, played: boolean, dur: number, now: number): EpisodeMap {
  const prev = map[id];
  const d = prev?.dur || dur || 0;
  return { ...map, [id]: { pos: played ? d : 0, dur: d, played, at: now } };
}

/** Where playback should start: the saved spot, unless it's played, barely started or at the very end. */
export function resumeAt(e: EpisodeEntry | undefined): number {
  if (!e || e.played || e.pos < 10 || e.pos > e.dur - 15) return 0;
  // A few seconds back, so the sentence that was cut off is heard again.
  return Math.max(0, e.pos - 3);
}

const fmtLeft = (sec: number) => {
  const m = Math.max(1, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min left` : `${m} min left`;
};

/** List progress from the local entry ("12 min left" / "Played"), or the server's when there's none. */
export function progressFor(e: EpisodeEntry | undefined, server: EpisodeInfo["progress"]): EpisodeInfo["progress"] {
  if (!e) return server;
  if (e.played) return { percent: 100, text: "Played", played: true };
  if (e.pos < 1) return server;
  return { percent: Math.round((e.pos / e.dur) * 100), text: fmtLeft(e.dur - e.pos), played: false };
}

function load(): EpisodeMap {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export const useEpisodeProgress = create<{ entries: EpisodeMap }>(() => ({ entries: typeof localStorage === "undefined" ? {} : load() }));

let pending: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(useEpisodeProgress.getState().entries));
    } catch {
      /* storage unavailable */
    }
  }, 1000);
}

export function savePosition(id: string, pos: number, dur: number) {
  useEpisodeProgress.setState((s) => ({ entries: record(s.entries, id, pos, dur, Date.now()) }));
  save();
}

export function markEpisode(id: string, played: boolean, dur = 0) {
  useEpisodeProgress.setState((s) => ({ entries: mark(s.entries, id, played, dur, Date.now()) }));
  save();
}

export const savedResume = (id: string) => resumeAt(useEpisodeProgress.getState().entries[id]);
