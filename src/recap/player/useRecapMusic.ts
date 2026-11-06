// Plays the recap's music (recap/music.ts) on its own <audio> elements, never the app's player: nothing is queued,
// logged or sent to the history. The playing song and the next one are loaded ahead and wait at their start point,
// so a switch is instant; songs crossfade. The app's own playback pauses for the recap and resumes after it; pressing
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
  const els = useRef<(HTMLAudioElement | null)[]>([]);
  const current = useRef(-1);
  const fading = useRef<ReturnType<typeof setInterval> | null>(null);
  const ended = useRef(false);
  const live = useRef(true);
  /** The app's player was playing and we paused it: it resumes when the recap closes. */
  const pausedMain = useRef(false);
  const volume = () => {
    const { volume: v, muted } = usePlayer.getState();
    return muted ? 0 : v;
  };

  /**
   * The element of song `i`, loading it on first use (one at a time: the playing song and the next one, so a slow
   * resolver isn't asked for all of them at once). It starts playing once it can, if it's still the one wanted.
   */
  const ensure = (i: number): HTMLAudioElement | null => {
    const id = videoIds[i];
    if (!id) return null;
    if (els.current[i]) return els.current[i];
    const el = new Audio();
    el.preload = "auto";
    el.loop = true;
    el.volume = 0;
    els.current[i] = el;
    let proxied = false;
    el.addEventListener("loadedmetadata", () => (el.currentTime = startAt(el.duration)));
    // A play() before the source arrives is aborted by load(), so the wanted song starts here.
    el.addEventListener("canplay", () => {
      if (live.current && !ended.current && current.current === i && el.paused) void el.play().catch(() => {});
    });
    void getStreamUrl(id).then((stream) => {
      if (!live.current) return;
      // The webview refuses some streams directly (the app's player does the same): once through the local proxy.
      el.addEventListener("error", () => {
        if (proxied || !live.current) return;
        proxied = true;
        void viaProxy(stream).then((s) => {
          if (!live.current) return;
          el.src = s.url;
          el.load();
        });
      });
      el.src = stream.url;
      el.load();
    }, () => {});
    return el;
  };

  useEffect(() => {
    live.current = true;
    // Play on a card starts the app's player: the recap's music gives way for good.
    const unsub = usePlayer.subscribe((s, prev) => {
      if (s.status === "playing" && prev.status !== "playing") {
        ended.current = true;
        for (const el of els.current) el?.pause();
      }
    });
    return () => {
      live.current = false;
      unsub();
      if (fading.current) clearInterval(fading.current);
      for (const el of els.current) if (el) silence(el);
      els.current = [];
      current.current = -1;
      if (pausedMain.current && !ended.current) usePlayer.getState().setPlaying(true);
      pausedMain.current = false;
    };
  }, [videoIds.join()]);

  // Switch songs (crossfade), or fade out when turned off. The app's music pauses only when the recap's plays.
  useEffect(() => {
    if (ended.current) return;
    if (on && videoIds.length && !pausedMain.current && usePlayer.getState().status === "playing") {
      usePlayer.getState().setPlaying(false);
      pausedMain.current = true;
    }
    const next = on ? ensure(song) : null;
    if (on) ensure(song + 1);
    const prev = els.current[current.current] ?? null;
    current.current = on ? song : -1;
    if (next === prev && next && !next.paused) return;
    if (fading.current) clearInterval(fading.current);
    const v = volume();
    if (next) {
      next.volume = 0;
      if (next.readyState >= 3) void next.play().catch(() => {});
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
