/** The 16 colors of a bundled palette (Material-style roles). */
export const PALETTE_KEYS = [
  "primary", "onPrimary", "secondary", "onSecondary", "tertiary", "onTertiary", "error", "onError",
  "surface", "onSurface", "surfaceVariant", "onSurfaceVariant", "outline", "shadow", "hover", "onHover",
] as const;
export type PaletteKey = (typeof PALETTE_KEYS)[number];
export type PaletteColors = Record<PaletteKey, string>;

export interface Palette {
  id: string;
  name: string;
  source: "builtin" | "bundled";
  dark?: PaletteColors;
  light?: PaletteColors;
}

export type Mode = "dark" | "light";
