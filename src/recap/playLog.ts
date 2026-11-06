// Sonolith's local play log: one entry per play, with exact times and the time really listened. A pure state
// machine fed by the playing <audio> element's own events (never the store's status, which can lag behind the
// element), so it can be unit tested without a player. recorder.ts wires it to the app and to storage.
import type { Track } from "../api/types";

export type PlayKind = "song" | "video" | "episode";
export type PlaySource = "queue" | "album" | "playlist" | "radio" | "autoplay" | "search";

/** One play as stored (one JSON line; a later line with the same `id` replaces an earlier one). */
export interface PlayEntry {
  id: string;
  videoId: string;
  type: PlayKind;
  title: string;
  artists: { id: string | null; name: string }[];
  album: { id: string | null; title: string } | null;
  durationMs: number;
  /** Cover art URL (recaps' palette and slides). */
  thumbnail?: string;
  /** When it started playing, epoch ms. */
  startedAt: number;
  /** Time actually played: pauses and skipped-over seek ranges don't count. */
  listenedMs: number;
  completed: boolean;
  /** Left before it counted as a play (kept only for "most skipped"). */
  skipped?: boolean;
  source?: PlaySource;
}

/** Seconds of listening before a play counts, the same threshold as the YouTube history ping (stores/history.ts). */
export const RECORD_AFTER_S = 10;

/** Whether `listenedS` seconds of a track `durationS` long count as a play: 10 s, or half of a shorter track. */
export const countsAsPlay = (listenedS: number, durationS: number) =>
  listenedS >= Math.min(RECORD_AFTER_S, durationS > 0 ? durationS / 2 : RECORD_AFTER_S);

/** The parts of a track the log keeps. */
export interface TrackInfo {
  videoId: string;
  type: PlayKind;
  title: string;
  artists: PlayEntry["artists"];
  album: PlayEntry["album"];
  durationMs: number;
  thumbnail?: string;
  source?: PlaySource;
}

export function trackInfo(t: Track, source?: PlaySource): TrackInfo {
  return {
    videoId: t.id,
    type: t.podcast ? "episode" : t.video ? "video" : "song",
    title: t.title,
    artists: t.artists.map((name, i) => ({ id: t.artistIds?.[i] ?? null, name })),
    album: t.album?.title ? { id: t.album.id ?? null, title: t.album.title } : null,
    durationMs: Math.round((t.durationSec ?? 0) * 1000),
    ...(t.thumbnail ? { thumbnail: t.thumbnail } : {}),
    source,
  };
}

/** Where a queue came from, by its playlist id and the track's own marker. */
export function sourceOf(t: Track, playlistId: string | undefined): PlaySource {
  if (t.source === "autoplay") return "autoplay";
  if (!playlistId) return "queue";
  if (/^(VL)?RD/.test(playlistId)) return "radio";
  if (/^(VL)?OLAK|^MPRE/.test(playlistId)) return "album";
  return "playlist";
}

/** How often a playing entry is written again (its listened time so far), so a crash loses at most this much. */
export const CHECKPOINT_MS = 30_000;
/** A timeupdate step longer than wall time allows (×2.5 for podcast speeds, + 1 s slack) is a jump, not playback. */
const MAX_RATE = 2.5;

interface Current {
  info: TrackInfo;
  entry: PlayEntry | null;
  /** Element position (s) at the last counted step; null while paused, seeking or before playing. */
  lastPos: number | null;
  lastAt: number;
  listenedMs: number;
  lastWrite: number;
  /** Already written as a counted play (later writes update it). */
  counted: boolean;
  ended: boolean;
}

/**
 * The play log's state machine. Every method that returns an entry wants it written (append; same id replaces).
 * `now` is wall-clock epoch ms, `pos` the element's currentTime in seconds.
 */
export class PlayTracker {
  private cur: Current | null = null;
  private seq = 0;
  /** Playing when a seek started: counting resumes when it lands. */
  private resumeAfterSeek = false;

  constructor(private makeId: (startedAt: number, videoId: string, seq: number) => string = (t, v, s) => `${t.toString(36)}-${s.toString(36)}-${v}`) {}

  /** The current track changed (or was set for the first time). Finishes the previous one. */
  track(info: TrackInfo | null, now: number): PlayEntry | null {
    const out = this.finish(now, "change");
    this.cur = info ? { info, entry: null, lastPos: null, lastAt: now, listenedMs: 0, lastWrite: 0, counted: false, ended: false } : null;
    return out;
  }

  /** The element knows the real length (episodes and videos often differ from the listing). */
  duration(seconds: number) {
    if (this.cur && Number.isFinite(seconds) && seconds > 0) this.cur.info = { ...this.cur.info, durationMs: Math.round(seconds * 1000) };
  }

  /** The element started or resumed playing at `pos`. */
  playing(pos: number, now: number): PlayEntry | null {
    const c = this.cur;
    if (!c) return null;
    // "Repeat one" and Replay start the same track again after it ended: that's a new play.
    if (c.ended) {
      this.track(c.info, now);
      return this.playing(pos, now);
    }
    if (!c.entry) {
      c.entry = this.newEntry(c.info, now);
      c.lastWrite = now;
    }
    c.lastPos = pos;
    c.lastAt = now;
    return null;
  }

  /** Playback moved on (timeupdate). Returns an entry when it just started counting or a checkpoint is due. */
  tick(pos: number, now: number): PlayEntry | null {
    const c = this.cur;
    if (!c || c.lastPos === null) return null;
    const d = pos - c.lastPos;
    const wall = Math.max(0, now - c.lastAt) / 1000;
    if (d > 0 && d <= wall * MAX_RATE + 1) c.listenedMs += Math.round(d * 1000);
    c.lastPos = pos;
    c.lastAt = now;
    if (!c.counted && countsAsPlay(c.listenedMs / 1000, c.info.durationMs / 1000)) {
      c.counted = true;
      return this.write(now);
    }
    if (c.counted && now - c.lastWrite >= CHECKPOINT_MS) return this.write(now);
    return null;
  }

  /** Paused (or stalled): time stops counting; a counted play is flushed. */
  paused(pos: number, now: number): PlayEntry | null {
    const c = this.cur;
    if (!c) return null;
    if (c.lastPos !== null) this.tick(pos, now);
    c.lastPos = null;
    return c.counted ? this.write(now) : null;
  }

  /**
   * Buffering: time stops counting until `playing`. Unlike a pause it doesn't flush (stalls can come every few
   * seconds); only what the last step itself asks to write (the play just counting, a due checkpoint) is returned.
   */
  stalled(pos: number, now: number): PlayEntry | null {
    const c = this.cur;
    if (!c || c.lastPos === null) return null;
    const out = this.tick(pos, now);
    c.lastPos = null;
    return out;
  }

  /**
   * A seek started: the range jumped over is not listened. The element's position is already the target, so the
   * time since the last timeupdate (under a second) is dropped.
   */
  seeking() {
    const c = this.cur;
    if (!c || c.lastPos === null) return;
    c.lastPos = null;
    this.resumeAfterSeek = true;
  }

  /** The seek landed; if the element is still playing, counting resumes from the new position. */
  seeked(pos: number, now: number, elementPaused: boolean) {
    const c = this.cur;
    if (c && this.resumeAfterSeek && !elementPaused && c.entry) {
      c.lastPos = pos;
      c.lastAt = now;
    }
    this.resumeAfterSeek = false;
  }

  /** Played to the end. */
  ended(pos: number, now: number): PlayEntry | null {
    const c = this.cur;
    if (!c) return null;
    if (c.lastPos !== null) this.tick(pos, now);
    c.lastPos = null;
    const out = this.finish(now, "ended");
    c.ended = true;
    c.entry = null;
    c.counted = false;
    c.listenedMs = 0;
    return out;
  }

  /** The window was hidden: nothing changes for playback, but a counted play is flushed in case the app quits. */
  hidden(pos: number, now: number, elementPaused: boolean): PlayEntry | null {
    const c = this.cur;
    if (!c) return null;
    if (!elementPaused && c.lastPos !== null) this.tick(pos, now);
    return c.counted ? this.write(now) : null;
  }

  /** The app is closing: the current play is written as it stands (never as a skip). */
  quit(pos: number, now: number, elementPaused: boolean): PlayEntry | null {
    const c = this.cur;
    if (!c) return null;
    if (!elementPaused && c.lastPos !== null) this.tick(pos, now);
    const out = c.counted ? this.write(now) : null;
    this.cur = null;
    return out;
  }

  private newEntry(info: TrackInfo, now: number): PlayEntry {
    return {
      id: this.makeId(now, info.videoId, this.seq++),
      videoId: info.videoId,
      type: info.type,
      title: info.title,
      artists: info.artists,
      album: info.album,
      durationMs: info.durationMs,
      ...(info.thumbnail ? { thumbnail: info.thumbnail } : {}),
      startedAt: now,
      listenedMs: 0,
      completed: false,
      ...(info.source ? { source: info.source } : {}),
    };
  }

  private write(now: number, completed = false): PlayEntry {
    const c = this.cur!;
    c.lastWrite = now;
    c.entry = { ...c.entry!, durationMs: c.info.durationMs, listenedMs: c.listenedMs, completed: completed || c.entry!.completed };
    return c.entry;
  }

  /** Closes the current play: a counted one gets its final numbers, one that started but didn't count is a skip. */
  private finish(now: number, why: "change" | "ended"): PlayEntry | null {
    const c = this.cur;
    if (!c || !c.entry) return null;
    if (c.lastPos !== null) c.lastPos = null;
    if (c.counted) {
      const dur = c.info.durationMs;
      // Ended, or left within the last few seconds (outros, crossfade-like handovers): complete.
      const completed = why === "ended" || (dur > 0 && c.listenedMs >= dur * 0.9);
      return this.write(now, completed);
    }
    // Ended without counting (a track shorter than its threshold can't, but a mostly skipped one can): no entry.
    if (why === "ended") return null;
    return { ...c.entry, listenedMs: c.listenedMs, durationMs: c.info.durationMs, skipped: true };
  }
}

/** Month file name of an entry, in local time: "2026-11". */
export function monthKey(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function validEntry(x: unknown): x is PlayEntry {
  const e = x as PlayEntry;
  return !!e && typeof e === "object" && typeof e.id === "string" && typeof e.videoId === "string" && typeof e.title === "string"
    && Number.isFinite(e.startedAt) && Number.isFinite(e.listenedMs) && Array.isArray(e.artists);
}

/**
 * Parses JSONL log text. A later line with the same id replaces the earlier one (checkpoints); broken lines (a torn
 * last line after a crash) and unknown shapes are skipped. Order: by start time.
 */
export function parseLog(text: string): PlayEntry[] {
  const byId = new Map<string, PlayEntry>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      continue;
    }
    if (!validEntry(v)) continue;
    const e = v as PlayEntry;
    byId.set(e.id, {
      ...e,
      type: e.type === "video" || e.type === "episode" ? e.type : "song",
      album: e.album && typeof e.album.title === "string" ? { id: e.album.id ?? null, title: e.album.title } : null,
      artists: e.artists.filter((a) => a && typeof a.name === "string").map((a) => ({ id: typeof a.id === "string" ? a.id : null, name: a.name })),
      durationMs: Number.isFinite(e.durationMs) ? e.durationMs : 0,
      thumbnail: typeof e.thumbnail === "string" && /^https:\/\//.test(e.thumbnail) ? e.thumbnail : undefined,
      completed: e.completed === true,
    });
  }
  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}
