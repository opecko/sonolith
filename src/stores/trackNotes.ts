// Song change notifications: follows the player and asks Rust (track_note.rs) for a notification when
// playback/trackNote.ts says so.
import { invoke } from "@tauri-apps/api/core";
import { byline } from "../components/PlayerBar";
import { trackToAnnounce } from "../playback/trackNote";
import { usePlayer } from "./player";
import { useSettings } from "./settings";

let started = false;
export function initTrackNotes() {
  if (started) return;
  started = true;
  // The song seen playing last, announced or not (a focused window skips it for good, it's on screen).
  let last: string | null = null;
  usePlayer.subscribe((s) => {
    const track = s.queue[s.index];
    const playing = s.status === "playing";
    const t = trackToAnnounce({ enabled: useSettings.getState().trackNotifications, track, playing, focused: document.hasFocus() && !document.hidden }, last);
    if (track && playing) last = track.id;
    if (t) invoke("track_notify", { title: t.title, body: byline(t), thumbnail: t.thumbnail ?? null }).catch(() => {});
  });
}
