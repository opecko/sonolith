import type { Palette } from "./types";

/** Lowercase without diacritics, so "rosé" finds "Rose" and "cafe" finds "Café". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Palettes whose name contains every word of the query (any order). */
export function searchPalettes(palettes: Palette[], query: string): Palette[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return palettes;
  return palettes.filter((p) => {
    const name = fold(`${p.name} ${p.id}`);
    return words.every((w) => name.includes(w));
  });
}
