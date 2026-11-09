import { stepVolume } from "../components/VolumeControl";
import { useOnboarding } from "../onboarding/store";
import { openPalette } from "../palette/store";
import { useRecapUi } from "../recap/ui";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { isTyping, matchAction, spaceOwnedByControl, type ShortcutAction } from "./keys";
import { showVolume, useShortcutUi } from "./store";

/** Seconds the arrow keys move the playhead. */
const SEEK_STEP = 5;

/** Within the current track; a live stream (no timeline) and an empty queue ignore it. */
function seekBy(sec: number) {
  const p = usePlayer.getState();
  if (p.index >= 0 && !p.live) p.skipBy(sec);
}

/** The same player actions the buttons use (play / pause goes through the element-truth toggle). */
const RUN: Record<ShortcutAction, () => void> = {
  playPause: () => usePlayer.getState().togglePlay(),
  prev: () => usePlayer.getState().prev(),
  next: () => usePlayer.getState().next(),
  seekBack: () => seekBy(-SEEK_STEP),
  seekForward: () => seekBy(SEEK_STEP),
  volumeUp: () => showVolume(stepVolume(1)),
  volumeDown: () => showVolume(stepVolume(-1)),
  commandPalette: () => openPalette(),
};

function onKeyDown(e: KeyboardEvent) {
  // A dialog or menu that handled the key (Esc, arrows, Enter) keeps it.
  if (e.defaultPrevented) return;
  const { enabled, bindings } = useSettings.getState().shortcuts;
  // The recap player has its own keys (←/→, Space, Esc) and turns the app's off while it's open.
  if (!enabled || useShortcutUi.getState().recording || useOnboarding.getState().open || useRecapUi.getState().open) return;
  const target = e.target as HTMLElement | null;
  const action = matchAction(
    { key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey, repeat: e.repeat, altGraph: e.getModifierState?.("AltGraph") },
    bindings,
  );
  if (!action) return;
  // Typing keeps its keys; only the command palette opens from a text field too (the search box, say).
  if (isTyping(target) && action !== "commandPalette") return;
  if (e.key === " " && spaceOwnedByControl(target)) return;
  // No button activation, no page scroll.
  e.preventDefault();
  RUN[action]();
}

/**
 * In-window shortcuts: one keydown listener on the window (bubble phase, after any dialog's own handling),
 * registered once. Off while typing, while Settings records a key, during onboarding and when switched off.
 * Separate from the global media keys (stores/mediaKeys.ts).
 */
let started = false;
export function initShortcuts() {
  if (started) return;
  started = true;
  window.addEventListener("keydown", onKeyDown);
}
