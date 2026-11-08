// Transparent window (Linux): what the window was created with (Rust, window.rs) and the stored switch. The surface
// tokens follow theme/glass.ts once the window turns out transparent.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { setGlassOpacity } from "../theme/glass";
import { flush, useSettings } from "./settings";

export interface WindowInfo {
  supported: boolean;
  transparent: boolean;
  transparentNext: boolean;
  composited: boolean | null;
  sessionType: string;
  desktop: string;
  hyprland: boolean;
}

export const useWindowGlass = create<{ info: WindowInfo | null }>(() => ({ info: null }));

let started = false;
/** Asks once at startup; `onChange` re-applies the theme when the window is transparent. */
export function initWindowGlass(onChange: () => void) {
  if (started) return;
  started = true;
  invoke<WindowInfo>("window_info").then((info) => {
    useWindowGlass.setState({ info });
    if (!info.transparent) return;
    setGlassOpacity(useSettings.getState().appearance.windowOpacity);
    document.documentElement.dataset.glass = "";
    onChange();
  }, () => {});
}

/** Stores the switch for the next start; the window itself can't change until then. */
export async function setTransparentWindow(enabled: boolean) {
  await invoke("window_set_transparent", { enabled });
  const info = useWindowGlass.getState().info;
  if (info) useWindowGlass.setState({ info: { ...info, transparentNext: enabled } });
}

/** Saves the settings, then restarts the app (for settings that only apply at startup). */
export async function restartApp() {
  flush();
  await invoke("app_restart");
}
