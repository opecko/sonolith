import { mix, withAlpha } from "./color";
import type { PaletteColors } from "./types";

/** Every themeable color token (`--c-<name>` on :root) with its built-in YT Music value; keep in sync with index.css. */
export const DEFAULT_TOKENS = {
  bg: "#030303",
  surface: "#0f0f0f",
  "surface-2": "#1d1d1d",
  "surface-3": "#282828",
  text: "#ffffff",
  "text-muted": "#ffffffb3",
  "text-subtle": "#ffffff80",
  accent: "#ff0033",
  "on-accent": "#ffffff",
  "accent-2": "#3ea6ff",
  outline: "#ffffff1a",
  hover: "#ffffff1a",
  active: "#ffffff29",
  "on-hover": "#ffffff",
  error: "#ff6b6b",
  button: "#ffffff",
  "on-button": "#000000",
  chip: "#ffffff1a",
  "chip-hover": "#ffffff33",
  scrollbar: "#ffffff2e",
  "scrollbar-hover": "#ffffff52",
  "slider-track": "#ffffff33",
  "slider-fill": "#ff0033",
  skeleton: "#1d1d1d",
  overlay: "#00000099",
  scrim: "#000000",
  "on-scrim": "#ffffff",
  focus: "#ffffffb3",
} as const;

export type Token = keyof typeof DEFAULT_TOKENS;
export type TokenMap = Record<Token, string>;
export const TOKENS = Object.keys(DEFAULT_TOKENS) as Token[];

export const TOKEN_LABELS: Record<Token, string> = {
  bg: "Background",
  surface: "Surface",
  "surface-2": "Surface 2 (cards, menus)",
  "surface-3": "Surface 3 (raised)",
  text: "Text",
  "text-muted": "Text muted",
  "text-subtle": "Text subtle",
  accent: "Accent",
  "on-accent": "Text on accent",
  "accent-2": "Secondary accent",
  outline: "Lines and borders",
  hover: "Hover",
  active: "Pressed",
  "on-hover": "Text on hover",
  error: "Error",
  button: "Filled button",
  "on-button": "Text on filled button",
  chip: "Chip",
  "chip-hover": "Chip hover",
  scrollbar: "Scrollbar",
  "scrollbar-hover": "Scrollbar hover",
  "slider-track": "Slider track",
  "slider-fill": "Slider fill",
  skeleton: "Loading placeholder",
  overlay: "Dialog backdrop",
  scrim: "Shade over artwork",
  "on-scrim": "Icons over artwork",
  focus: "Focus ring",
};

/**
 * Palette → tokens. Direct: surface→bg, surfaceVariant→surface-2, primary→accent, onPrimary→on-accent,
 * secondary→accent-2, onSurface→text, onSurfaceVariant→text-muted, outline→outline, hover/onHover→hover/on-hover,
 * error→error, shadow→scrim. The rest are shades derived from those so every palette gets a complete theme;
 * a palette's hover is a saturated color, so rows only get a light wash of it.
 */
export function paletteTokens(p: PaletteColors): TokenMap {
  const fg = p.onSurface;
  return {
    bg: p.surface,
    surface: mix(p.surface, fg, 0.04),
    "surface-2": p.surfaceVariant,
    "surface-3": mix(p.surfaceVariant, fg, 0.08),
    text: fg,
    "text-muted": mix(p.onSurfaceVariant, p.surface, 0.25),
    "text-subtle": mix(p.onSurfaceVariant, p.surface, 0.45),
    accent: p.primary,
    "on-accent": p.onPrimary,
    "accent-2": p.secondary,
    outline: withAlpha(p.outline, 0.6),
    hover: withAlpha(p.hover, 0.16),
    active: withAlpha(p.hover, 0.26),
    "on-hover": p.onHover,
    error: p.error,
    button: p.primary,
    "on-button": p.onPrimary,
    chip: withAlpha(fg, 0.1),
    "chip-hover": withAlpha(fg, 0.2),
    scrollbar: withAlpha(fg, 0.18),
    "scrollbar-hover": withAlpha(fg, 0.32),
    "slider-track": withAlpha(fg, 0.2),
    "slider-fill": p.primary,
    skeleton: p.surfaceVariant,
    overlay: withAlpha(p.shadow, 0.6),
    scrim: p.shadow,
    "on-scrim": "#ffffff",
    focus: mix(p.onSurfaceVariant, p.surface, 0.25),
  };
}
