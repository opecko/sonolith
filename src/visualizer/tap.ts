import { useSettings } from "../stores/settings";

/**
 * The visualizer's ear on Sonolith's own <audio> element (never the system's audio): Web Audio's
 * MediaElementSource → AnalyserNode → speakers.
 *
 * Two traps decide how this works (docs/dev/pitfalls.md):
 * - A cross-origin element without CORS feeds Web Audio silence, and googlevideo sends no CORS headers for the
 *   app's origin. So while the visualizer is on, the player routes streams through the local proxy (which does)
 *   with `crossOrigin = "anonymous"` (`wantsCors`).
 * - `createMediaElementSource` can't be undone: from then on the element is only heard through the AudioContext.
 *   So the tap is made only once the current stream is CORS-clean and the context really runs (a suspended one
 *   would mute playback), and after that every stream keeps going through the proxy until the app restarts.
 */

export const FFT_SIZE = 2048;

let audio: HTMLMediaElement | null = null;
let corsReady: () => boolean = () => false;
let reroute: () => Promise<void> = async () => {};
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let starting = false;
let nextTry = 0;

/** Called once by the player with its element, whether its current stream can be read, and how to make it so. */
export function bindTap(el: HTMLMediaElement, opts: { corsReady: () => boolean; reroute: () => Promise<void> }) {
  audio = el;
  corsReady = opts.corsReady;
  reroute = opts.reroute;
}

/** Whether new streams must be CORS-clean: the visualizer is on, or the element is already tapped. */
export const wantsCors = () => !!analyser || useSettings.getState().visualizer.mode !== "off";
/** The element is tapped: a stream that isn't CORS-clean would play silent. */
export const tapped = () => !!analyser;

/** The analyser, or null while it can't hear the audio yet; asking starts the tap (rate-limited) when possible. */
export function getAnalyser(): AnalyserNode | null {
  if (analyser || starting || !audio) return analyser;
  const now = performance.now();
  if (now < nextTry) return null;
  nextTry = now + 1000;
  starting = true;
  void start().finally(() => (starting = false));
  return null;
}

async function start() {
  const el = audio;
  if (!el || analyser) return;
  if (!corsReady()) return reroute();
  try {
    ctx ??= new AudioContext({ latencyHint: "playback" });
    if (ctx.state !== "running") await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
    // Without a user gesture the context may stay suspended; tapping now would mute playback, so try later.
    if (ctx.state !== "running" || !corsReady()) return;
    const a = ctx.createAnalyser();
    a.fftSize = FFT_SIZE;
    a.smoothingTimeConstant = 0; // smoothing is ours (spectrum.ts), per frame drawn rather than per call
    a.minDecibels = -100;
    a.maxDecibels = -10;
    const source = ctx.createMediaElementSource(el);
    // In the chain rather than a side branch: an unconnected analyser may never be pulled.
    source.connect(a);
    a.connect(ctx.destination);
    analyser = a;
    const c = ctx;
    // Playback now depends on this context: whatever suspends it (device changes), get it going again.
    c.addEventListener("statechange", () => {
      if (c.state !== "running" && c.state !== "closed") void c.resume().catch(() => {});
    });
    for (const ev of ["pointerdown", "keydown", "focus"]) window.addEventListener(ev, () => c.state !== "running" && void c.resume().catch(() => {}), { passive: true });
  } catch (e) {
    nextTry = Infinity; // no Web Audio here (or the element was already taken): don't keep trying every second
    console.warn("visualizer: could not tap the audio", e);
  }
}
