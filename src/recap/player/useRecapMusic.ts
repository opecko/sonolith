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
  const fadingOut = useRef<HTMLAudioElement | null>(null);
  const ended = useRef(false);
  /** Bumped when the elements are dropped: late stream answers for older ones are ignored (StrictMode remounts). */
  const gen = useRef(0);
  /** The app's player was playing and we paused it: it comes back when the recap closes or its music goes off. */
  const pausedMain = useRef(false);
  /** Our own pause/resume of the app's player, not the user pressing Play. */
  const ownChange = useRef(false);
  const volume = () => {
    const { volume: v, muted } = usePlayer.getState();
    return muted ? 0 : v;
  };
  const setMain = (playing: boolean) => {
    ownChange.current = true;
    usePlayer.getState().setPlaying(playing);
    ownChange.current = false;
  };

  /** Fades `prev` out and `next` in (either may be null) over FADE_MS, starting now. */
  const crossfade = (prev: HTMLAudioElement | null, next: HTMLAudioElement | null) => {
    if (fading.current) clearInterval(fading.current);
    // A fade cut short: the song it was fading out stops now (unless it's the one coming in).
    if (fadingOut.current && fadingOut.current !== next && fadingOut.current !== prev) fadingOut.current.pause();
    fadingOut.current = prev && prev !== next ? prev : null;
    const v = volume();
    if (next) next.volume = 0;
    // The outgoing song fades from wherever it is (a fade taken over halfway doesn't jump back up).
    const from = prev ? prev.volume : 0;
    const t0 = performance.now();
    fading.current = setInterval(() => {
      const f = fade((performance.now() - t0) / FADE_MS, v);
      if (prev && prev !== next) prev.volume = v > 0 ? (from * f.out) / v : 0;
      if (next) next.volume = f.in;
      if (performance.now() - t0 >= FADE_MS) {
        clearInterval(fading.current!);
        fading.current = null;
        if (prev && prev !== next) prev.pause();
        fadingOut.current = null;
      }
    }, 50);
  };

  /**
   * The element of song `i`, loading it on first use (one at a time: the playing song and the next one, so a slow
   * resolver isn't asked for all of them at once). When it becomes playable and is still the one wanted, it starts
   * and fades in from there.
   */
  const ensure = (i: number): HTMLAudioElement | null => {
    const id = videoIds[i];
    if (!id) return null;
    if (els.current[i]) return els.current[i];
    const mine = gen.current;
    const alive = () => gen.current === mine;
    const el = new Audio();
    el.preload = "auto";
    el.loop = true;
    el.volume = 0;
    els.current[i] = el;
    let proxied = false;
    el.addEventListener("loadedmetadata", () => (el.currentTime = startAt(el.duration)));
    // A play() before the source arrives is aborted by load(), so the wanted song starts here.
    el.addEventListener("canplay", () => {
      if (!alive() || ended.current || current.current !== i || !el.paused) return;
      void el.play().catch(() => {});
      crossfade(fadingOut.current, el);
    });
    void getStreamUrl(id).then((stream) => {
      if (!alive()) return;
      // The webview refuses some streams directly (the app's player does the same): once through the local proxy.
      el.addEventListener("error", () => {
        if (proxied || !alive()) return;
        proxied = true;
        void viaProxy(stream).then((s) => {
          if (!alive()) return;
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
    // Play on a card starts the app's player: the recap's music gives way for good.
    const unsub = usePlayer.subscribe((s, prev) => {
      if (!ownChange.current && s.status === "playing" && prev.status !== "playing") {
        ended.current = true;
        pausedMain.current = false;
        for (const el of els.current) el?.pause();
      }
    });
    return () => {
      gen.current++;
      unsub();
      if (fading.current) clearInterval(fading.current);
      for (const el of els.current) if (el) silence(el);
      els.current = [];
      current.current = -1;
      if (pausedMain.current && !ended.current) setMain(true);
      pausedMain.current = false;
    };
  }, [videoIds.join()]);

  // Switch songs (crossfade), or fade out when turned off. The app's music pauses only while the recap's plays.
  useEffect(() => {
    if (ended.current) return;
    if (on && videoIds.length && !pausedMain.current && usePlayer.getState().status === "playing") {
      setMain(false);
      pausedMain.current = true;
    }
    const next = on ? ensure(song) : null;
    if (on) ensure(song + 1);
    const prev = els.current[current.current] ?? null;
    current.current = on ? song : -1;
    if (next === prev && next && !next.paused) return;
    // Not loaded yet: the old song fades out now, the new one fades in when it can play (canplay above).
    const ready = !!next && next.readyState >= 3;
    if (ready) void next.play().catch(() => {});
    crossfade(prev, ready ? next : null);
    // Music turned off: the app's playback comes back.
    if (!on && pausedMain.current) {
      pausedMain.current = false;
      setMain(true);
    }
  }, [song, on]);
}
