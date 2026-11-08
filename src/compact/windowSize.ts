// The window's size in CSS pixels, for the small-window UIs (layout.ts). One resize listener for the whole app.
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { create } from "zustand";
import { grownSize, windowMode } from "./layout";

const read = () => ({ width: window.innerWidth, height: window.innerHeight });

interface WindowSizeState {
  width: number;
  height: number;
  /** "Full app" couldn't grow the window: show the full layout anyway until the window is resized. */
  forceFull: boolean;
}

export const useWindowSize = create<WindowSizeState>(() =>
  ({ ...(typeof window === "undefined" ? { width: 0, height: 0 } : read()), forceFull: false }));

// While "Full app" waits for the compositor, size changes are its answer, not the user resizing.
let growing = false;

let started = false;
/** Follows window resizes; once, whatever StrictMode does. */
export function initWindowSize() {
  if (started) return;
  started = true;
  const update = () => {
    const next = read(), cur = useWindowSize.getState();
    if (next.width === cur.width && next.height === cur.height) return;
    // The user resized the window after forcing the full app: the size decides again.
    useWindowSize.setState(growing ? next : { ...next, forceFull: false });
  };
  window.addEventListener("resize", update);
  update();
}

// How long the compositor gets to apply the new size before the full layout is forced.
const GROW_WAIT_MS = 600;

/**
 * "Make the window bigger" from the mini player and the too-small notice. Compositors may ignore the request (tiling
 * ones decide sizes themselves, some keep a floating window's size); then the full layout is shown in the window as
 * it is, so the button always gets the user to the whole app.
 */
export function growWindow() {
  if (growing) return;
  growing = true;
  const done = () => {
    const { width, height } = read();
    if (windowMode(width, height) !== "full") useWindowSize.setState({ forceFull: true });
    setTimeout(() => (growing = false), GROW_WAIT_MS);
  };
  // Logical pixels: the webview zoom is left out on purpose, the target is a comfortable window, not a CSS size.
  void (async () => {
    try {
      const win = getCurrentWindow();
      const logical = (await win.innerSize()).toLogical(await win.scaleFactor());
      const { width, height } = grownSize(logical.width, logical.height);
      await win.setSize(new LogicalSize(width, height));
    } catch (e) {
      console.warn("Could not resize the window:", e);
    }
    setTimeout(done, GROW_WAIT_MS);
  })();
}
