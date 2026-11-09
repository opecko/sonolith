// The startup screen (index.html) shows before any stylesheet or module has loaded, so it can't read the theme. Each
// run saves the colors it needs here; the next start paints them right away instead of an empty (or, with a
// transparent window, see-through) window.
import { parseHex, toHex } from "./color";
import { clampOpacity } from "./glass";
import type { TokenMap } from "./tokens";

/** localStorage key; index.html reads the same one. */
export const SPLASH_KEY = "splash";

export interface Splash {
  /** Window background, opaque. */
  bg: string;
  /** Text color. */
  fg: string;
  /** Surface opacity for a transparent window (index.html applies it only when the window is transparent). */
  opacity: number;
}

/** What to save for the next start: the palette's background (made opaque) and text, and the surface opacity. */
export function splashFor(t: Pick<TokenMap, "bg" | "text">, opacity: number): Splash {
  const solid = (c: string) => {
    const x = parseHex(c);
    return x ? toHex({ ...x, a: 1 }) : c;
  };
  return { bg: solid(t.bg), fg: solid(t.text), opacity: clampOpacity(opacity) };
}

/** Saves only when something changed (the theme is applied often; storage writes are not free). */
export function saveSplash(s: Splash) {
  try {
    const json = JSON.stringify(s);
    if (localStorage.getItem(SPLASH_KEY) !== json) localStorage.setItem(SPLASH_KEY, json);
  } catch {
    /* storage unavailable: the next start shows the default colors */
  }
}
