import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mediaArtwork } from "../api/art";
import { nativeMpris } from "./platform";
import { usePlayer, type Repeat } from "./player";
import { useProgress } from "./progress";

const LOOP: Record<Repeat, string> = { off: "None", all: "Playlist", one: "Track" };
const REPEAT: Record<string, Repeat> = { None: "off", Playlist: "all", Track: "one" };
/** A position further than this from where playback should be counts as a seek. */
const SEEK_JUMP_S = 1.5;

let started = false;

/** Mirrors the player to the Rust MPRIS service (state snapshots out, D-Bus controls in). Linux only. */
export async function initMpris() {
  // StrictMode runs effects twice; a second listener would apply every relative seek twice.
  if (!nativeMpris || started) return;
  started = true;
  const p = () => usePlayer.getState();

  await listen<{ action: string; value: unknown }>("mpris", ({ payload: { action, value } }) => {
    const s = p();
    switch (action) {
      case "play": s.setPlaying(true); break;
      case "pause": case "stop": s.setPlaying(false); break;
      case "playpause": s.togglePlay(); break;
      case "next": s.next(); break;
      case "previous": s.prev(); break;
      case "seek": s.skipBy(value as number); break;
      case "setposition": s.seek(value as number); break;
      case "volume": s.setVolume(value as number); break;
      case "shuffle": if (s.shuffle !== value) s.toggleShuffle(); break;
      case "loop": {
        const want = REPEAT[value as string];
        for (let i = 0; want && i < 3 && p().repeat !== want; i++) p().cycleRepeat();
        break;
      }
    }
  });

  let last = "";
  let sentPos = 0;
  let sentAt = 0;
  const push = (force = false) => {
    const s = p();
    const t = s.queue[s.index];
    const { position, duration } = useProgress.getState();
    const status = s.status === "playing" || s.status === "loading" ? "Playing" : t && s.status !== "error" ? "Paused" : "Stopped";
    const key = JSON.stringify([t?.id, t?.title, status, s.volume, s.muted, s.shuffle, s.repeat, s.index > 0 || s.repeat !== "off", s.index < s.queue.length - 1 || s.repeat !== "off", Math.round(duration)]);
    if (!force && key === last) return;
    last = key;
    sentPos = position;
    sentAt = Date.now();
    const len = Number.isFinite(duration) && duration > 0 ? duration : t?.durationSec;
    void invoke("mpris_update", {
      snapshot: {
        status,
        track: t && {
          id: t.id,
          title: t.title,
          // An episode: its show as artist and album (what podcast-aware players show).
          artists: t.podcast ? [t.show?.title || t.subtitle].filter(Boolean) : t.artists.length ? t.artists : t.subtitle ? [t.subtitle] : [],
          album: t.podcast ? t.show?.title : t.album?.title,
          art: mediaArtwork(t.thumbnail, t.id)[0]?.src,
          lengthUs: len ? Math.round(len * 1e6) : undefined,
        },
        positionUs: Math.round(position * 1e6),
        volume: s.muted ? 0 : s.volume,
        shuffle: s.shuffle,
        loopStatus: LOOP[s.repeat],
        canNext: s.index < s.queue.length - 1 || s.repeat !== "off",
        canPrev: s.index >= 0,
        canSeek: !!t && !!len,
      },
    }).catch(() => {});
  };
  usePlayer.subscribe(() => push());
  // The clock ticks constantly; only a jump away from the expected position (a seek) is worth sending.
  useProgress.subscribe(({ position }) => {
    const playing = p().status === "playing";
    const expected = sentPos + (playing ? (Date.now() - sentAt) / 1000 : 0);
    if (Math.abs(position - expected) > SEEK_JUMP_S) push(true);
  });
  push(true);
}
