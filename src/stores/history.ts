import { recordHistory } from "../api/ytm";
import { useAuth } from "./auth";
import { countsAsPlay } from "../recap/playLog";
import { useDevSlot } from "./devSlot";
import { onPlaybackTick, playbackTime, usePlayer } from "./player";
import { useProgress } from "./progress";
import { useSettings } from "./settings";


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
    if (!id || recorded || status !== "playing" || !useSettings.getState().saveHistory || useAuth.getState().status !== "signedIn") return;
    // The real playback time: the displayed position stands still while the window is hidden (tray).
    const position = playbackTime();
    const { duration } = useProgress.getState();
    // 10 s, or half of a shorter track; the local play log (recap/playLog.ts) uses the same threshold.
    if (!countsAsPlay(position, duration)) return;
    recorded = true;
    // Dev toolkit's "Don't save played tracks to history"; the whole condition is false (and dropped) in release.
    if (import.meta.env.DEV && useDevSlot.getState().skipHistory?.()) return;
    recordHistory(id).catch((e) => console.warn("history ping failed:", e));
  };

  usePlayer.subscribe(check);
  onPlaybackTick(check);
}
