// Transparent window (Linux): the surface tokens get the "Surface opacity" alpha, so the compositor shows (and
// may blur) what's behind the window. Text, icons, accents and pictures keep their own colors. Menus, dialogs and
// tooltips read the -float variants, which never go below FLOAT_MIN, so they stay readable over busy content.
import { withAlpha } from "./color";
import type { Token, TokenMap } from "./tokens";

export const OPACITY_MIN = 0.3;
export const OPACITY_MAX = 1;
export const DEFAULT_OPACITY = 0.85;
/** The least opaque a menu, dialog or tooltip gets, whatever the surface opacity. */
export const FLOAT_MIN = 0.92;

/** The tokens that paint large areas: window background, bars, cards, raised surfaces. */
export const SURFACE_TOKENS: readonly Token[] = ["bg", "surface", "surface-2", "surface-3"];

/** A stored or typed opacity as a valid one: 0.3–1, rounded to whole percent; anything else is the default. */
export function clampOpacity(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_OPACITY;
  return Math.round(Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, v)) * 100) / 100;
}

/** Opacity for menus, dialogs and tooltips. */
export const floatOpacity = (opacity: number) => Math.max(clampOpacity(opacity), FLOAT_MIN);

/**
 * The custom properties a transparent window puts on top of the theme: `--c-<surface>` and `--c-<surface>-float`.
 * withAlpha multiplies, so a token that is already translucent stays relatively so.
 */
export function glassVars(all: TokenMap, opacity: number): Record<string, string> {
  const o = clampOpacity(opacity), f = floatOpacity(o);
  const out: Record<string, string> = {};
  for (const t of SURFACE_TOKENS) {
    out[`--c-${t}`] = withAlpha(all[t], o);
    out[`--c-${t}-float`] = withAlpha(all[t], f);
  }
  return out;
}

/** Every property glassVars may write, to take them off again. */
export const GLASS_PROPS = SURFACE_TOKENS.flatMap((t) => [`--c-${t}`, `--c-${t}-float`]);

/** The surface opacity while the window is transparent; null = an opaque window (the default, and Windows). */
let active: number | null = null;
export const glassOpacity = () => active;
export function setGlassOpacity(opacity: number | null) {
  active = opacity === null ? null : clampOpacity(opacity);
}
