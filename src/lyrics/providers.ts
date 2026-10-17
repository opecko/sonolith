/** Lyrics providers as the backend knows them (src-tauri/src/lyrics), in the default order. */
export const LYRICS_PROVIDERS = ["youtube", "betterlyrics", "unison", "lyricsplus", "kugou", "lrclib"] as const;
export type LyricsProviderId = (typeof LYRICS_PROVIDERS)[number];

/** Names for Settings and the credit line ("Lyrics from LRCLIB"). */
export const PROVIDER_NAMES: Record<LyricsProviderId, string> = {
  youtube: "YouTube Music",
  betterlyrics: "Better Lyrics",
  unison: "Unison",
  lyricsplus: "LyricsPlus",
  kugou: "KuGou",
  lrclib: "LRCLIB",
};

export interface ProviderSetting {
  id: LyricsProviderId;
  enabled: boolean;
}

export const DEFAULT_LYRICS_PROVIDERS: ProviderSetting[] = LYRICS_PROVIDERS.map((id) => ({ id, enabled: true }));

const known = (id: unknown): id is LyricsProviderId => typeof id === "string" && (LYRICS_PROVIDERS as readonly string[]).includes(id);

/**
 * Stored order → settings: unknown providers dropped, duplicates removed, providers added in a later version
 * appended (on), a broken value back to the defaults.
 */
export function normalizeLyricsProviders(raw: unknown): ProviderSetting[] {
  if (!Array.isArray(raw)) return DEFAULT_LYRICS_PROVIDERS;
  const out: ProviderSetting[] = [];
  for (const r of raw) {
    const id = r && typeof r === "object" ? (r as { id?: unknown }).id : undefined;
    if (!known(id) || out.some((p) => p.id === id)) continue;
    out.push({ id, enabled: (r as { enabled?: unknown }).enabled !== false });
  }
  for (const id of LYRICS_PROVIDERS) if (!out.some((p) => p.id === id)) out.push({ id, enabled: true });
  return out;
}

/** The ids to ask, highest priority first; empty = lyrics off. */
export const enabledProviders = (list: ProviderSetting[]) => list.filter((p) => p.enabled).map((p) => p.id);
