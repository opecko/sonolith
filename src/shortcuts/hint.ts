import { useSettings } from "../stores/settings";
import { formatBinding, type ShortcutAction } from "./keys";

/** The key bound to an action, for tooltips ("Next (>)"); null while shortcuts are off. Follows rebinding. */
export function useShortcutKey(action: ShortcutAction): string | null {
  return useSettings((s) => (s.shortcuts.enabled ? formatBinding(s.shortcuts.bindings[action]) : null));
}

export const withKey = (label: string, key: string | null) => (key ? `${label} (${key})` : label);

/** Tooltips for the transport buttons: "Previous (<)", "Pause (Space)", "Next (>)". */
export function useTransportTitles() {
  const prev = useShortcutKey("prev"), play = useShortcutKey("playPause"), next = useShortcutKey("next");
  return { prev: withKey("Previous", prev), next: withKey("Next", next), play: (playing: boolean) => withKey(playing ? "Pause" : "Play", play) };
}
