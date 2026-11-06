// Resolved audio streams by video id, so the same song isn't resolved again while its URL is still good: repeat,
// replay, going back, gapless preparation and prefetch all share one resolution, also while it's still running.
// That matters when the slow path (yt-dlp, several seconds, ~20 s on Windows) is the only one that works.

/** A stream URL is reused until 10 minutes before googlevideo's `expire`, and never longer than this. */
export const MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** When the URL says nothing about its expiry. */
export const DEFAULT_AGE_MS = 30 * 60 * 1000;
const MARGIN_MS = 10 * 60 * 1000;
/** A resolution still running after this is given up on (a hung yt-dlp): the next play starts a new one. */
export const IN_FLIGHT_MAX_MS = 90 * 1000;
const MAX_ENTRIES = 64;

/** When a stream URL stops being usable, epoch ms (from its `expire` parameter, seconds). */
export function expiresAt(url: string | undefined, now: number): number {
  const m = url ? /[?&]expire=(\d{9,11})(?:&|$)/.exec(url) : null;
  if (!m) return now + DEFAULT_AGE_MS;
  return Math.min(now + MAX_AGE_MS, Number(m[1]) * 1000 - MARGIN_MS);
}

interface Entry<T> {
  promise: Promise<T>;
  /** Until when it may be used; while the resolution is still running, until it counts as stuck. */
  until: number;
}

export class StreamCache<T extends { origin?: string; live?: boolean }> {
  private entries = new Map<string, Entry<T>>();

  /** A usable entry (running or resolved and not expired). */
  get(id: string, now: number): Promise<T> | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (now >= e.until) {
      this.entries.delete(id);
      return null;
    }
    return e.promise;
  }

  /** Keeps a resolution; failures and live streams (endless, per session) are dropped once known. */
  put(id: string, promise: Promise<T>, now: () => number): Promise<T> {
    const entry: Entry<T> = { promise, until: now() + IN_FLIGHT_MAX_MS };
    this.entries.delete(id);
    this.entries.set(id, entry);
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    promise.then(
      (s) => {
        if (this.entries.get(id) !== entry) return;
        if (s.live) this.entries.delete(id);
        else entry.until = expiresAt(s.origin, now());
      },
      () => this.entries.get(id) === entry && this.entries.delete(id),
    );
    return promise;
  }

  delete(id: string) {
    this.entries.delete(id);
  }
}

/**
 * Skips InnerTube for a while once it has failed for two songs in a row (an account without Premium when YouTube's
 * other clients stop serving complete streams): each attempt costs a second before the slow path anyway.
 */
export class Breaker {
  private failures = 0;
  private openUntil = 0;
  constructor(private readonly after = 2, private readonly forMs = 15 * 60 * 1000) {}
  open(now: number) {
    return now < this.openUntil;
  }
  failed(now: number) {
    if (++this.failures >= this.after) {
      this.openUntil = now + this.forMs;
      this.failures = 0;
    }
  }
  succeeded() {
    this.failures = 0;
    this.openUntil = 0;
  }
}
