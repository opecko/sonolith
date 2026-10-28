import { useEffect, useRef, useState } from "react";
import { getVideoStreamUrl } from "../api/stream";
import { FIRST_GUESS, learn, videoSync } from "../playback/videoSync";
import { getAudio } from "../stores/player";
import { Spinner } from "./LoadingIndicator";

/** How often the video is checked against the audio clock while shown (timeupdate alone is too coarse to steer by). */
const TICK_MS = 250;
/** After a seek lands, it's judged once the picture has been moving this long (the `seeked` event comes first). */
const SETTLE_MS = 500;

/**
 * The muted video of a podcast episode or music video, slaved to the playing <audio>, which keeps the sound and
 * stays the clock (playback/videoSync.ts decides seeks, rate nudges and play/pause). Mounted only in video mode,
 * so nothing downloads otherwise; stops decoding while the window is hidden. A stream that fails is resolved
 * afresh once, at the same spot.
 */
export default function TrackVideo({ videoId }: { videoId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The first frame is in: from then on the picture stays up (a seek or a stall doesn't bring the spinner back).
  const [loaded, setLoaded] = useState(false);
  const retried = useRef(false);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setError(null);
    setLoaded(false);
    retried.current = false;
    getVideoStreamUrl(videoId).then(
      (url) => live && setSrc(url),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [videoId]);

  useEffect(() => {
    const v = ref.current;
    const a = getAudio();
    if (!v || !src) return;
    let lastSeek = -Infinity;
    let learnt = FIRST_GUESS;
    /** A seek this loop made, waiting to be judged: when it landed (0: not yet). */
    let judging: { landed: number } | null = null;
    let force = true;
    const tick = () => {
      if (document.hidden) {
        if (!v.paused) v.pause();
        force = true;
        return;
      }
      if (v.readyState < 1) return; // no metadata yet: loadedmetadata ticks again
      const now = performance.now();
      // WebKitGTK reports HAVE_CURRENT_DATA (2) for a streamed video even while it plays fine, so 2 isn't "busy".
      const busy = v.seeking || v.readyState < 2;
      const audioPlaying = !a.paused && !a.ended && a.readyState >= 3;
      // Where the last seek really landed, once the picture moves again: the next one aims accordingly.
      if (judging?.landed && !busy && !v.paused && audioPlaying && now - judging.landed > SETTLE_MS) {
        learnt = learn(learnt, a.currentTime - v.currentTime);
        judging = null;
      }
      const act = videoSync({
        audioTime: a.currentTime,
        audioRate: a.playbackRate,
        audioPlaying,
        videoTime: v.currentTime,
        videoBusy: busy,
        sinceSeek: (now - lastSeek) / 1000,
        learnt,
        force,
        videoDuration: v.duration,
      });
      force = false;
      if (act.seek !== undefined) {
        v.currentTime = act.seek;
        lastSeek = now;
        // Judged only for seeks made while playing (a paused one lands exactly).
        judging = act.play ? { landed: 0 } : null;
      }
      // Only when the audio's speed changes (podcasts): on WebKitGTK every rate change flushes the pipeline.
      if (Math.abs(v.playbackRate - act.rate) > 0.001) v.playbackRate = act.rate;
      if (act.play && v.paused) void v.play().catch(() => {});
      else if (!act.play && !v.paused) v.pause();
    };
    const onSeeked = () => {
      if (judging) judging.landed = performance.now();
    };
    const forced = () => {
      force = true;
      tick();
    };
    const timer = setInterval(tick, TICK_MS);
    for (const ev of ["play", "pause", "playing", "waiting", "ratechange"]) a.addEventListener(ev, tick);
    a.addEventListener("seeked", forced);
    v.addEventListener("loadedmetadata", forced);
    v.addEventListener("canplay", tick);
    v.addEventListener("seeked", onSeeked);
    document.addEventListener("visibilitychange", forced);
    tick();
    return () => {
      clearInterval(timer);
      for (const ev of ["play", "pause", "playing", "waiting", "ratechange"]) a.removeEventListener(ev, tick);
      a.removeEventListener("seeked", forced);
      v.removeEventListener("loadedmetadata", forced);
      v.removeEventListener("canplay", tick);
      v.removeEventListener("seeked", onSeeked);
      document.removeEventListener("visibilitychange", forced);
    };
  }, [src]);

  // Expired URL, a proxy entry gone, a stream the webview refused: once, a freshly resolved URL (the sync loop seeks
  // it to the audio's position when its metadata loads).
  const onError = () => {
    if (retried.current) return setError("This video can't be played.");
    retried.current = true;
    setLoaded(false);
    getVideoStreamUrl(videoId, true).then(setSrc, (e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[var(--radius)] bg-scrim">
      {src && <video ref={ref} src={src} muted playsInline preload="auto" onError={onError} onLoadedData={() => setLoaded(true)} className="h-full w-full object-contain" />}
      {!loaded && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner size={32} className="text-[var(--c-text-muted)]" label="Loading video" />
        </div>
      )}
      {error && <p className="px-6 text-center text-sm text-[var(--c-text-muted)]">{error}</p>}
    </div>
  );
}
