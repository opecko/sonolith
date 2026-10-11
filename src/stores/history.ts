import { recordHistory } from "../api/ytm";
import { onPlaybackTick, playbackTime, usePlayer } from "./player";
import { useProgress } from "./progress";
import { useSettings } from "./settings";

/** Seconds of actual listening before a play counts (quick skips don't land in the history). */
const RECORD_AFTER_S = 10;

/** Records each play in the YouTube Music history once it has really been listened to. */
export function initHistory() {
  let currentId: string | null = null;
  let recorded = false;

  const check = () => {
    const { queue, index, status } = usePlayer.getState();
    const id = queue[index]?.id ?? null;
    if (id !== currentId) {
      currentId = id;
      recorded = false;
    }
    if (!id || recorded || status !== "playing" || !useSettings.getState().saveHistory) return;
    // The real playback time: the displayed position stands still while the window is hidden (tray).
    const position = playbackTime();
    const { duration } = useProgress.getState();
    // Short tracks count once half of them has played.
    if (position < Math.min(RECORD_AFTER_S, duration > 0 ? duration / 2 : RECORD_AFTER_S)) return;
    recorded = true;
    recordHistory(id).catch((e) => console.warn("history ping failed:", e));
  };

  usePlayer.subscribe(check);
  onPlaybackTick(check);
}
