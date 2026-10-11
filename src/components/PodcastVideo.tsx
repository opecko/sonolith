import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getVideoStreamUrl } from "../api/stream";
import { getAudio } from "../stores/player";

const MAX_DRIFT_S = 0.35;

/**
 * Muted video track of a podcast episode, slaved to the playing <audio> (which keeps the sound and stays the clock):
 * play/pause, seeks, speed and drift are mirrored. Mounted only in video mode, so nothing downloads otherwise.
 */
export default function PodcastVideo({ videoId }: { videoId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const proxied = useRef(false);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setError(null);
    proxied.current = false;
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
    const sync = (force = false) => {
      // Nobody sees the (muted) video while the window is hidden: stop decoding (and seeking) it until it's back.
      if (document.hidden) {
        if (!v.paused) v.pause();
        return;
      }
      if (v.playbackRate !== a.playbackRate) v.playbackRate = a.playbackRate;
      if (force || Math.abs(v.currentTime - a.currentTime) > MAX_DRIFT_S) v.currentTime = a.currentTime;
      if (a.paused && !v.paused) v.pause();
      else if (!a.paused && v.paused) void v.play().catch(() => {});
    };
    const onSeek = () => sync(true);
    const onTick = () => sync();
    a.addEventListener("play", onTick);
    a.addEventListener("pause", onTick);
    a.addEventListener("seeked", onSeek);
    a.addEventListener("ratechange", onTick);
    a.addEventListener("timeupdate", onTick);
    v.addEventListener("loadedmetadata", onSeek);
    const onVisibility = () => sync(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      a.removeEventListener("play", onTick);
      a.removeEventListener("pause", onTick);
      a.removeEventListener("seeked", onSeek);
      a.removeEventListener("ratechange", onTick);
      a.removeEventListener("timeupdate", onTick);
      v.removeEventListener("loadedmetadata", onSeek);
    };
  }, [src]);

  // WebKitGTK may refuse the raw googlevideo URL: retry once through the local Range proxy (src-tauri/src/proxy.rs).
  const onError = () => {
    if (!src || proxied.current) return setError("This video can't be played.");
    proxied.current = true;
    invoke<string>("proxy_url", { url: src }).then(setSrc, (e) => setError(String(e)));
  };

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[var(--radius)] bg-scrim">
      {src && <video ref={ref} src={src} muted playsInline preload="auto" onError={onError} className="h-full w-full object-contain" />}
      {!src && !error && <Loader2 size={32} className="animate-spin text-[var(--c-text-muted)]" aria-label="Loading video" />}
      {error && <p className="px-6 text-center text-sm text-[var(--c-text-muted)]">{error}</p>}
    </div>
  );
}
