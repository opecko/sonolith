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

/**
 * Tokens that follow another one unless set themselves, so changing a main color (as the Simple editor does)
 * carries over: a custom accent also recolors the slider fill. For the built-in look index.css does the same
 * through var(); palettes also tie the filled buttons to the accent (that's how they map).
 */
const FOLLOWS: [Token, Token][] = [["slider-fill", "accent"], ["skeleton", "surface-2"], ["focus", "text-muted"]];
const PALETTE_FOLLOWS: [Token, Token][] = [...FOLLOWS, ["button", "accent"], ["on-button", "on-accent"]];

/** `inline`: what goes on <html> (palette, then `extra`, then overrides); `all`: what every token shows as. */
function resolve(t: ThemeChoice, extra: Partial<TokenMap> = {}): { inline: Partial<TokenMap>; all: TokenMap } {
  const base = paletteValues(t);
  const o = validOverrides(t.overrides);
  const inline: Partial<TokenMap> = { ...(base ?? {}), ...extra, ...o };
  for (const [dep, src] of base ? PALETTE_FOLLOWS : FOLLOWS) {
    const changed = o[src] ?? extra[src];
    if (changed && !o[dep] && !extra[dep]) inline[dep] = changed;
  }
  const all = { ...DEFAULT_TOKENS, ...inline } as TokenMap;
  if (!base) for (const [dep, src] of FOLLOWS) if (!inline[dep]) all[dep] = all[src];
  return { inline, all };
}

/** What each token resolves to on screen (for the editor and the contrast checks). */
export const effectiveTokens = (t: ThemeChoice): TokenMap => resolve(t).all;

/**
 * Writes the theme onto <html> as inline custom properties (only what differs from index.css). `extra` (the
 * artwork accent) sits between the palette and the user's own overrides.
 */
export function applyTheme(t: ThemeChoice, extra: Partial<TokenMap> = {}, root: HTMLElement = document.documentElement) {
  const { inline, all } = resolve(t, extra);
  for (const k of TOKENS) {
    const v = inline[k];
    if (v) root.style.setProperty(`--c-${k}`, v);
    else root.style.removeProperty(`--c-${k}`);
  }
  // Native widgets (scrollbars, form controls, <input type=color>) follow the background's lightness.
  root.style.colorScheme = isLight(all.bg) ? "light" : "dark";
}

/** Corner radius and density (zoom is the webview's own, see main.tsx). */
export function applyLayout(a: { radius: number; density: "normal" | "compact" }, root: HTMLElement = document.documentElement) {
  root.style.setProperty("--radius", `${a.radius}px`);
  root.dataset.density = a.density;
}
