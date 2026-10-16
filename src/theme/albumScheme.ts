import { argbFromRgb, Hct, hexFromArgb, QuantizerCelebi, SchemeNeutral, SchemeTonalSpot, Score, type DynamicScheme } from "@material/material-color-utilities";
import { mix, withAlpha } from "./color";
import type { TokenMap } from "./tokens";

/**
 * "Colors from album art": the whole color scheme generated from the current cover, M3 dynamic color style.
 *
 * Variant: TonalSpot (the Material You default). It keeps the source hue for primary with moderate chroma and
 * calm, slightly tinted neutrals, so the app looks like the cover without shouting and text stays readable on
 * every surface. Expressive was the other candidate, but it deliberately rotates hues away from the source, so a
 * red cover gives a purple app; Fidelity/Content follow the source chroma and turn loud covers into loud
 * backgrounds. Spec 2025 is the Material 3 Expressive color spec. A grey cover (source chroma under 12) gets
 * Neutral instead: TonalSpot would invent a colorful primary for it.
 */

/** Sentinel for "no colorful color in the art" (Score falls back to it). */
const NONE = 0;

/**
 * Source color (ARGB) of RGBA pixels from a small downscaled cover: quantized (Celebi) and ranked (Score) like
 * Material's own `sourceColorFromImage`. Grey artwork has no suitable color; then its most common color is used,
 * which gives a near-neutral scheme. Null when there are no opaque pixels.
 */
export function sourceColor(px: Uint8ClampedArray): number | null {
  const pixels: number[] = [];
  for (let i = 0; i + 3 < px.length; i += 4) if (px[i + 3] === 255) pixels.push(argbFromRgb(px[i], px[i + 1], px[i + 2]));
  if (!pixels.length) return null;
  const counts = QuantizerCelebi.quantize(pixels, 128);
  const [best] = Score.score(counts, { fallbackColorARGB: NONE });
  if (best !== NONE) return best;
  let top: number | null = null, n = -1;
  for (const [c, k] of counts) if (k > n) [top, n] = [c, k];
  return top;
}

export function schemeFor(source: number, dark: boolean): DynamicScheme {
  const hct = Hct.fromInt(source);
  return hct.chroma < 12 ? new SchemeNeutral(hct, dark, 0, "2025") : new SchemeTonalSpot(hct, dark, 0, "2025");
}

const hex = (argb: number) => hexFromArgb(argb).toLowerCase();

/** The scheme's roles mapped onto every `--c-*` token (the same jobs the bundled palettes fill). */
export function schemeTokens(source: number, dark: boolean): TokenMap {
  const s = schemeFor(source, dark);
  const fg = hex(s.onSurface), surface = hex(s.surface), variant = hex(s.onSurfaceVariant);
  return {
    bg: surface,
    surface: hex(s.surfaceContainerLow),
    "surface-2": hex(s.surfaceContainerHigh),
    "surface-3": hex(s.surfaceContainerHighest),
    text: fg,
    "text-muted": variant,
    "text-subtle": mix(variant, surface, 0.35),
    accent: hex(s.primary),
    "on-accent": hex(s.onPrimary),
    "accent-2": hex(s.secondary),
    outline: hex(s.outlineVariant),
    hover: withAlpha(fg, 0.1),
    active: withAlpha(fg, 0.16),
    "on-hover": fg,
    error: hex(s.error),
    button: hex(s.primary),
    "on-button": hex(s.onPrimary),
    chip: withAlpha(fg, 0.1),
    "chip-hover": withAlpha(fg, 0.2),
    scrollbar: withAlpha(fg, 0.18),
    "scrollbar-hover": withAlpha(fg, 0.32),
    "slider-track": withAlpha(fg, 0.2),
    "slider-fill": hex(s.primary),
    skeleton: hex(s.surfaceContainerHigh),
    overlay: withAlpha(hex(s.scrim), 0.6),
    scrim: hex(s.scrim),
    "on-scrim": "#ffffff",
    focus: variant,
  };
}

/** `from` blended toward `to` by `t` for every token (the track-change transition). */
export function mixTokens(from: TokenMap, to: TokenMap, t: number): TokenMap {
  const out = {} as TokenMap;
  for (const k of Object.keys(to) as (keyof TokenMap)[]) out[k] = t >= 1 ? to[k] : mix(from[k] ?? to[k], to[k], t);
  return out;
}
