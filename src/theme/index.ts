import { isHex, isLight } from "./color";
import { getPalette } from "./palettes";
import { DEFAULT_TOKENS, paletteTokens, TOKENS, type Token, type TokenMap } from "./tokens";
import type { Mode } from "./types";

/** The color part of the Appearance settings. */
export interface ThemeChoice {
  /** Palette id; "ytm" (or unknown) = the built-in look. */
  palette: string;
  mode: Mode;
  /** Per-token hex overrides on top of the palette; survive palette changes. */
  overrides: Partial<Record<Token, string>>;
}

/** Token values set by the palette alone; null for the built-in look (index.css defaults apply). */
export function paletteValues(t: ThemeChoice): TokenMap | null {
  const p = getPalette(t.palette);
  if (p.source === "builtin") return null;
  const colors = p[t.mode] ?? p.dark ?? p.light;
  return colors ? paletteTokens(colors) : null;
}

const validOverrides = (o: ThemeChoice["overrides"]) =>
  Object.fromEntries(Object.entries(o).filter(([k, v]) => k in DEFAULT_TOKENS && typeof v === "string" && isHex(v))) as Partial<TokenMap>;

/** What each token resolves to on screen (for the editor and the contrast checks). */
export function effectiveTokens(t: ThemeChoice): TokenMap {
  const base = paletteValues(t);
  const o = validOverrides(t.overrides);
  const m = { ...(base ?? DEFAULT_TOKENS), ...o } as TokenMap;
  // Built-in look: these follow other tokens through CSS var() unless set themselves.
  if (!base) {
    if (!o["slider-fill"]) m["slider-fill"] = m.accent;
    if (!o.skeleton) m.skeleton = m["surface-2"];
    if (!o.focus) m.focus = m["text-muted"];
  }
  return m;
}

/** Writes the theme onto <html> as inline custom properties (only what differs from index.css). */
export function applyTheme(t: ThemeChoice, root: HTMLElement = document.documentElement) {
  const set = { ...(paletteValues(t) ?? {}), ...validOverrides(t.overrides) } as Partial<TokenMap>;
  for (const k of TOKENS) {
    const v = set[k];
    if (v) root.style.setProperty(`--c-${k}`, v);
    else root.style.removeProperty(`--c-${k}`);
  }
  // Native widgets (scrollbars, form controls, <input type=color>) follow the background's lightness.
  root.style.colorScheme = isLight(effectiveTokens(t).bg) ? "light" : "dark";
}
