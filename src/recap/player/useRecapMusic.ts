// Plays the recap's music (recap/music.ts) on its own <audio> elements, never the app's player: nothing is queued,
// logged or sent to the history. All songs load as soon as the recap opens and wait at their start point, so a
// switch is instant; songs crossfade. The app's own playback pauses for the recap and resumes after it; pressing
// Play on a card (the app's player) ends the recap's music.
import { useEffect, useRef } from "react";
import { getStreamUrl, viaProxy } from "../../api/stream";
import { usePlayer } from "../../stores/player";
import { fade, startAt } from "../music";

const FADE_MS = 1500;

function silence(el: HTMLAudioElement) {
  el.pause();
  el.removeAttribute("src");
  el.load();
}

export function useRecapMusic(videoIds: string[], song: number, on: boolean) {
  const els = useRef<HTMLAudioElement[]>([]);
  const current = useRef(-1);
  const fading = useRef<ReturnType<typeof setInterval> | null>(null);
  const ended = useRef(false);
  const volume = () => {
    const { volume: v, muted } = usePlayer.getState();
    return muted ? 0 : v;
  };

  // Load everything up front, each waiting at its start point.
  useEffect(() => {
    let live = true;
    els.current = videoIds.map((id) => {
      const el = new Audio();
      el.preload = "auto";
      el.loop = true;
      el.volume = 0;
      let proxied = false;
      void getStreamUrl(id).then((stream) => {
        if (!live) return;
        el.src = stream.url;
        el.addEventListener("loadedmetadata", () => (el.currentTime = startAt(el.duration)), { once: true });
        // The webview refuses some streams directly (the app's player does the same): once through the local proxy.
        el.addEventListener("error", () => {
          if (proxied || !live) return;
          proxied = true;
          void viaProxy(stream).then((s) => live && (el.src = s.url, el.load()));
        });
        el.load();
      }, () => {});
      return el;
    });
    // The app's music pauses for the recap and comes back after it.
    const resume = usePlayer.getState().status === "playing";
    if (resume) usePlayer.getState().setPlaying(false);
    // Play on a card starts the app's player: the recap's music gives way for good.
    const unsub = usePlayer.subscribe((s, prev) => {
      if (s.status === "playing" && prev.status !== "playing") {
        ended.current = true;
        for (const el of els.current) el.pause();
      }
    });
    return () => {
      live = false;
      unsub();
      if (fading.current) clearInterval(fading.current);
      for (const el of els.current) silence(el);
      els.current = [];
      if (resume && !ended.current) usePlayer.getState().setPlaying(true);
    };
  }, [videoIds.join()]);

  // Switch songs (crossfade), or fade out when turned off.
  useEffect(() => {
    if (ended.current) return;
    const next = on ? els.current[song] ?? null : null;
    const prev = els.current[current.current] ?? null;
    if (next === prev && next && !next.paused) return;
    current.current = on ? song : -1;
    if (fading.current) clearInterval(fading.current);
    const v = volume();
    if (next) {
      next.volume = 0;
      void next.play().catch(() => {});
    }
    const t0 = performance.now();
    fading.current = setInterval(() => {
      const f = fade((performance.now() - t0) / FADE_MS, v);
      if (prev && prev !== next) prev.volume = f.out;
      if (next) next.volume = f.in;
      if (performance.now() - t0 >= FADE_MS) {
        clearInterval(fading.current!);
        fading.current = null;
        if (prev && prev !== next) prev.pause();
      }
    }, 50);
  }, [song, on]);
}
