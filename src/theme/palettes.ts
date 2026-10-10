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
