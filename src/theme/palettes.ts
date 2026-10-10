import bundled from "./palettes.json";
import type { Palette } from "./types";

/** The app's own look (index.css defaults); selecting it removes every inline token. */
export const BUILTIN_ID = "ytm";
export const BUILTIN: Palette = { id: BUILTIN_ID, name: "YouTube Music", source: "builtin" };

/** Built-in look first, then the bundled palettes (src/theme/palettes.json). */
export const PALETTES: Palette[] = [BUILTIN, ...(bundled as Omit<Palette, "source">[]).map((p) => ({ ...p, source: "bundled" as const }))];

const byId = new Map(PALETTES.map((p) => [p.id, p]));
export const getPalette = (id: string | null | undefined): Palette => (id && byId.get(id)) || BUILTIN;

/** Whether the palette has the given variant (the built-in look is dark only). */
export const hasMode = (p: Palette, mode: "dark" | "light") => (p.source === "builtin" ? mode === "dark" : !!p[mode]);

/** Colors for a palette card: background, card, accent, text… (built-in look = index.css defaults). */
export function previewOf(p: Palette, mode: "dark" | "light") {
  const c = p[mode] ?? p.dark ?? p.light;
  if (!c) {
    return { bg: "#030303", card: "#1d1d1d", accent: "#ff0033", onAccent: "#ffffff", text: "#ffffff", muted: "#ffffffb3",
      strip: ["#030303", "#1d1d1d", "#ff0033", "#3ea6ff", "#ffffffb3", "#ffffff"] };
  }
  return { bg: c.surface, card: c.surfaceVariant, accent: c.primary, onAccent: c.onPrimary, text: c.onSurface, muted: c.onSurfaceVariant,
    strip: [c.surface, c.surfaceVariant, c.primary, c.secondary, c.tertiary, c.onSurface] };
}
