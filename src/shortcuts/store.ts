import { create } from "zustand";

interface ShortcutUi {
  /** Settings is recording a new key: shortcuts are off until it ends. */
  recording: boolean;
  /** The volume a shortcut just set (0–1), shown for a moment; null when nothing is shown. */
  volume: number | null;
}

export const useShortcutUi = create<ShortcutUi>(() => ({ recording: false, volume: null }));

let hide: ReturnType<typeof setTimeout> | undefined;
export function showVolume(v: number) {
  clearTimeout(hide);
  useShortcutUi.setState({ volume: v });
  hide = setTimeout(() => useShortcutUi.setState({ volume: null }), 1200);
}
