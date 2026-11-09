// "Keep the screen on while playing" (Settings → Playback): when the screen may sleep. Pure; stores/keepAwake.ts
// times it and Rust (awake.rs) asks the system.

/** A short pause, a track change or a slow start doesn't let the screen go just to stop it again a second later. */
export const RELEASE_AFTER_MS = 5000;

/** Whether the screen should stay on now: the setting, and something playing (or loading to play). */
export function wantAwake(enabled: boolean, status: string, hasTrack: boolean): boolean {
  return enabled && hasTrack && (status === "playing" || status === "loading");
}
