import { invoke } from "@tauri-apps/api/core";
import { currentStream, getAudio } from "../stores/player";

/**
 * The visualizer's ear: a silent copy of the song Sonolith is playing (never other apps' audio), kept in step
 * with the player and analysed with Web Audio.
 *
 * The player's own element is never touched (docs/dev/pitfalls.md): routed through an AudioContext on WebKitGTK,
 * the analyser got the audio but the speakers got silence. The copy instead is captured by
 * `createMediaElementSource` before it ever plays, so it is only heard through a graph that ends in a zero gain.
 * Web Audio needs CORS-clean audio and googlevideo sends no CORS headers to the app, so the copy streams through
 * the local proxy (`proxy_url`, which does) with `crossOrigin` set. It runs only while a visualizer is on screen.
 */

export const FFT_SIZE = 2048;
/** How far the copy may drift from the player before it jumps back in step, in seconds. */
const MAX_DRIFT = 0.3;
const SYNC_EVERY_MS = 1500;

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let copy: HTMLAudioElement | null = null;
let failed = false;
let users = 0;
/** The player's stream URL the copy was loaded for, and whether that worked. */
let loadedFor: string | null = null;
let ready = false;
let lastSync = 0;
let lastPlay = 0;

function setup(): boolean {
  if (analyser) return true;
  if (failed) return false;
  try {
    const c = new AudioContext({ latencyHint: "playback" });
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    // Captured before it has a source, so it can never be heard directly.
    const source = c.createMediaElementSource(el);
    const a = c.createAnalyser();
    a.fftSize = FFT_SIZE;
    a.smoothingTimeConstant = 0; // smoothing is ours (spectrum.ts), per frame drawn rather than per call
    a.minDecibels = -100;
    a.maxDecibels = -10;
    const mute = c.createGain();
    mute.gain.value = 0;
    // Ends at the destination so the graph is pulled; the zero gain keeps it silent.
    source.connect(a);
    a.connect(mute);
    mute.connect(c.destination);
    getAudio().addEventListener("seeked", () => users > 0 && ready && sync(true));
    ctx = c;
    copy = el;
    analyser = a;
    return true;
  } catch (e) {
    failed = true; // no Web Audio here: the visualizer just stays still
    console.warn("visualizer: no Web Audio", e);
    return false;
  }
}

function sync(force = false) {
  const main = getAudio();
  if (!copy || copy.readyState < 1) return;
  if (copy.playbackRate !== main.playbackRate) copy.playbackRate = main.playbackRate;
  if (force || Math.abs(copy.currentTime - main.currentTime) > MAX_DRIFT) copy.currentTime = main.currentTime;
}

async function load(url: string, proxied: boolean) {
  const el = copy!;
  loadedFor = url;
  ready = false;
  el.pause();
  try {
    const src = proxied ? url : await invoke<string>("proxy_url", { url });
    if (loadedFor !== url) return;
    el.addEventListener("loadedmetadata", () => sync(true), { once: true });
    el.src = src;
    ready = true;
  } catch {
    // Not a stream the proxy serves: no visualizer for this song.
    if (loadedFor === url) el.removeAttribute("src");
  }
}

/** A visualizer came on screen; returns the function to call when it goes. The copy stops with the last one. */
export function acquire(): () => void {
  users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--users > 0) return;
    copy?.pause();
    void ctx?.suspend().catch(() => {});
  };
}

/**
 * The analyser, following the player (call it once per drawn frame): loads the copy on a new song, plays and
 * pauses it with the player, and pulls it back in step. Null while there's nothing to analyse.
 */
export function analyserFor(): AnalyserNode | null {
  const main = getAudio();
  const stream = currentStream();
  // A live stream is an HLS playlist of segments the proxy can't make CORS-clean: no visualizer for it.
  if (main.paused || !stream || stream.live || !setup()) {
    if (copy && !copy.paused) copy.pause();
    return null;
  }
  if (stream.url !== loadedFor) {
    void load(stream.url, !!stream.proxied);
    return null;
  }
  if (!ready || !copy) return null;
  if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
  const now = performance.now();
  if (now - lastSync > SYNC_EVERY_MS) {
    lastSync = now;
    sync();
  }
  // Rate-limited: a play() that keeps failing must not seek the copy every frame.
  if (copy.paused && now - lastPlay > 1000) {
    lastPlay = now;
    sync(true);
    void copy.play().catch(() => {});
  }
  return analyser;
}
