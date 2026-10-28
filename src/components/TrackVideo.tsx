import { useEffect, useRef, useState } from "react";
import { getVideoStreamUrl } from "../api/stream";
import { videoSync } from "../playback/videoSync";
import { getAudio } from "../stores/player";
import { Spinner } from "./LoadingIndicator";

/** How often the video is checked against the audio clock while shown (timeupdate alone is too coarse to steer by). */
const TICK_MS = 250;
/** Buffering this long shows the spinner over the video (a quick seek doesn't flash it). */
const SPINNER_AFTER_MS = 400;

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
  const [buffering, setBuffering] = useState(false);
  const retried = useRef(false);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setError(null);
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
    let busySince = 0;
    let force = true;
    const tick = () => {
      if (document.hidden) {
        if (!v.paused) v.pause();
        force = true;
        return;
      }
      if (v.readyState < 1) return; // no metadata yet: loadedmetadata ticks again
      const now = performance.now();
      const busy = v.seeking || v.readyState < 3;
      const act = videoSync({
        audioTime: a.currentTime,
        audioRate: a.playbackRate,
        audioPlaying: !a.paused && !a.ended && a.readyState >= 3,
        videoTime: v.currentTime,
        videoBusy: busy,
        sinceSeek: (now - lastSeek) / 1000,
        force,
        videoDuration: v.duration,
      });
      force = false;
      if (act.seek !== undefined) {
        v.currentTime = act.seek;
        lastSeek = now;
      }
      if (Math.abs(v.playbackRate - act.rate) > 0.001) v.playbackRate = act.rate;
      if (act.play && v.paused) void v.play().catch(() => {});
      else if (!act.play && !v.paused) v.pause();
      busySince = busy && act.play ? busySince || now : 0;
      setBuffering(!!busySince && now - busySince > SPINNER_AFTER_MS);
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
    document.addEventListener("visibilitychange", forced);
    tick();
    return () => {
      clearInterval(timer);
      for (const ev of ["play", "pause", "playing", "waiting", "ratechange"]) a.removeEventListener(ev, tick);
      a.removeEventListener("seeked", forced);
      v.removeEventListener("loadedmetadata", forced);
      v.removeEventListener("canplay", tick);
      document.removeEventListener("visibilitychange", forced);
    };
  }, [src]);

  // Expired URL, a proxy entry gone, a stream the webview refused: once, a freshly resolved URL (the sync loop seeks
  // it to the audio's position when its metadata loads).
  const onError = () => {
    if (retried.current) return setError("This video can't be played.");
    retried.current = true;
    getVideoStreamUrl(videoId, true).then(setSrc, (e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[var(--radius)] bg-scrim">
      {src && <video ref={ref} src={src} muted playsInline preload="auto" onError={onError} className="h-full w-full object-contain" />}
      {((!src && !error) || buffering) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Spinner size={32} className="text-[var(--c-text-muted)]" label="Loading video" />
        </div>
      )}
      {error && <p className="px-6 text-center text-sm text-[var(--c-text-muted)]">{error}</p>}
    </div>
  );
}
