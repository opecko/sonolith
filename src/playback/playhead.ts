import { useEffect, type RefObject } from "react";
import { ticker } from "../motion";

/**
 * Smooth playback position between `timeupdate` events. The element's clock may move in coarse steps; the estimate
 * runs on from the last step at the playback rate, never more than half a second ahead of it, and doesn't step back
 * by a few frames when the next coarse value lands slightly behind. `reset()` snaps (seek, rate change, new track).
 * Pure: the caller passes the element's time and the frame time.
 */
export class Interpolator {
  private base = -1;
  private at = 0;
  private last = -1;

  reset() {
    this.base = -1;
    this.last = -1;
  }

  sample(current: number, nowMs: number, rate: number, playing: boolean): number {
    if (!playing || this.base < 0 || current !== this.base) {
      // A newer value from the element (or a stop): start extrapolating from it.
      const fresh = this.base < 0 || !playing;
      this.base = current;
      this.at = nowMs;
      if (fresh) this.last = -1;
      if (!playing) return (this.last = current);
    }
    let t = Math.min(this.base + ((nowMs - this.at) / 1000) * rate, this.base + 0.5);
    // A coarse step that lands a hair behind the estimate: hold still instead of flicking back.
    if (this.last >= 0 && t < this.last && this.last - t < 0.3) t = this.last;
    return (this.last = t);
  }
}

let el: HTMLAudioElement | null = null;
const interp = new Interpolator();
const subs = new Set<(sec: number) => void>();
let stopFrames: (() => void) | null = null;

/** The smooth playback position, in seconds. */
export const playheadTime = () => (el ? interp.sample(el.currentTime, performance.now(), el.playbackRate, !el.paused) : 0);

function emit() {
  if (!subs.size) return;
  const t = playheadTime();
  for (const fn of subs) fn(t);
}

/**
 * One frame loop for everything that follows the playhead (seek bars, karaoke lyrics). It runs only while
 * something visible listens, the audio plays and motion runs (window shown, animations on — the motion engine's
 * ticker pauses with them); otherwise listeners hear the clock on its events (timeupdate, seek, pause, rate).
 */
function updateLoop() {
  const want = subs.size > 0 && !!el && !el.paused;
  if (want && !stopFrames) stopFrames = ticker(emit);
  else if (!want && stopFrames) {
    stopFrames();
    stopFrames = null;
  }
}

/** Called once by the player with its audio element. */
export function bindPlayhead(audio: HTMLAudioElement) {
  el = audio;
  const snap = () => {
    interp.reset();
    emit();
    updateLoop();
  };
  for (const ev of ["seeking", "seeked", "ratechange", "pause", "play", "playing", "loadstart", "emptied", "durationchange"]) audio.addEventListener(ev, snap);
  // Without frames (paused loop, animations off) the coarse clock still moves the listeners.
  audio.addEventListener("timeupdate", () => !stopFrames && emit());
}

/** Listen to the playhead (every frame while playing, else on clock events); called once right away. */
export function onPlayhead(fn: (sec: number) => void): () => void {
  subs.add(fn);
  fn(playheadTime());
  updateLoop();
  return () => {
    subs.delete(fn);
    updateLoop();
  };
}

/** `onPlayhead` only while `ref`'s element is on screen (a closed panel or a scrolled-away tile costs nothing). */
export function useVisiblePlayhead(ref: RefObject<Element | null>, fn: ((sec: number) => void) | null) {
  useEffect(() => {
    const node = ref.current;
    if (!node || !fn) return;
    let stop: (() => void) | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !stop) stop = onPlayhead(fn);
      else if (!e.isIntersecting && stop) {
        stop();
        stop = null;
      }
    });
    io.observe(node);
    return () => {
      io.disconnect();
      stop?.();
    };
  }, [ref, fn]);
}
