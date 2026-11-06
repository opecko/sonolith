// Feeds the play log's state machine from the playing <audio> element and writes what it returns. Runs signed out
// too; records nothing with "Save history" or "Keep a local listening log" off (or the dev "don't save history").
import { useDevSlot } from "../stores/devSlot";
import { getAudio, onAudioEvent, usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { PlayTracker, sourceOf, trackInfo, type PlayEntry } from "./playLog";
import { appendPlays } from "./storage";

let started = false;

const recording = () => {
  const s = useSettings.getState();
  if (!s.saveHistory || !s.recap.localLog) return false;
  // Dev toolkit's "Don't save played tracks to history"; the whole condition is false (and dropped) in release.
  if (import.meta.env.DEV && useDevSlot.getState().skipHistory?.()) return false;
  return true;
};

export function initPlayLog() {
  if (started) return;
  started = true;
  const tracker = new PlayTracker();
  let currentId: string | null = null;

  const write = (e: PlayEntry | null) => {
    if (e && recording()) void appendPlays([e]);
  };
  /** Follows the store's current track; every audio event checks it first, so event order doesn't matter. */
  const sync = () => {
    const { queue, index, context } = usePlayer.getState();
    const t = queue[index];
    const id = t?.id ?? null;
    if (id === currentId) return;
    currentId = id;
    write(tracker.track(t ? trackInfo(t, sourceOf(t, context.playlistId)) : null, Date.now()));
  };
  const el = () => getAudio();
  usePlayer.subscribe(sync);
  onAudioEvent("playing", () => {
    sync();
    write(tracker.playing(el().currentTime, Date.now()));
  });
  onAudioEvent("pause", () => {
    sync();
    write(tracker.paused(el().currentTime, Date.now()));
  });
  onAudioEvent("waiting", () => write(tracker.stalled(el().currentTime, Date.now())));
  onAudioEvent("timeupdate", () => {
    sync();
    if (!el().paused) write(tracker.tick(el().currentTime, Date.now()));
  });
  onAudioEvent("seeking", () => tracker.seeking());
  onAudioEvent("seeked", () => tracker.seeked(el().currentTime, Date.now(), el().paused));
  onAudioEvent("durationchange", () => tracker.duration(el().duration));
  onAudioEvent("ended", () => write(tracker.ended(el().currentTime, Date.now())));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) write(tracker.hidden(el().currentTime, Date.now(), el().paused));
  });
  window.addEventListener("pagehide", () => write(tracker.quit(el().currentTime, Date.now(), el().paused)));
  sync();
}
