// The window's size in CSS pixels, for the small-window UIs (layout.ts). One resize listener for the whole app.
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { create } from "zustand";
import { grownSize } from "./layout";

const read = () => ({ width: window.innerWidth, height: window.innerHeight });

export const useWindowSize = create<{ width: number; height: number }>(() =>
  typeof window === "undefined" ? { width: 0, height: 0 } : read());

let started = false;
/** Follows window resizes; once, whatever StrictMode does. */
export function initWindowSize() {
  if (started) return;
  started = true;
  const update = () => {
    const next = read(), cur = useWindowSize.getState();
    if (next.width !== cur.width || next.height !== cur.height) useWindowSize.setState(next);
  };
  window.addEventListener("resize", update);
  update();
}

/**
 * "Make the window bigger" from the mini player and the too-small notice. Tiling compositors decide sizes
 * themselves and may ignore it; nothing to do about that here.
 */
export function growWindow() {
  // Logical pixels: the webview zoom is left out on purpose, the target is a comfortable window, not a CSS size.
  const win = getCurrentWindow();
  void win.innerSize().then(async (inner) => {
    const logical = inner.toLogical(await win.scaleFactor());
    const { width, height } = grownSize(logical.width, logical.height);
    await win.setSize(new LogicalSize(width, height));
  }).catch(() => {});
}
