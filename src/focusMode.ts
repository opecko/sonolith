import { isTyping } from "./shortcuts/keys";

/** Keys that move focus around: Tab both ways, and arrows inside widgets (not while editing text). */
export function navigationKey(key: string, typing: boolean): boolean {
  if (key === "Tab") return true;
  return !typing && (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End");
}

/**
 * Focus rings show only while navigating by keyboard: Tab or arrows set `data-keyboard-nav` on <html>, any pointer
 * press clears it (index.css draws rings only under it). Enter, Space and app shortcuts leave it as it is, so a
 * click followed by Enter or a shortcut never lights up a ring. One pair of listeners for the whole app.
 */
let started = false;
export function initFocusMode() {
  if (started) return;
  started = true;
  const root = document.documentElement;
  window.addEventListener("keydown", (e) => {
    if (navigationKey(e.key, isTyping(e.target as HTMLElement | null))) root.setAttribute("data-keyboard-nav", "");
  }, true);
  window.addEventListener("pointerdown", () => root.removeAttribute("data-keyboard-nav"), true);
}
