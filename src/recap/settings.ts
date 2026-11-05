/** Settings → Recaps. */
export interface RecapSettings {
  /** Keep Sonolith's own listening log on this computer (exact times, real listened time). */
  localLog: boolean;
  /** How often a recap includes little games. */
  games: "sometimes" | "always" | "never";
  /** Cards move on by themselves after a few seconds. */
  autoAdvance: boolean;
  /** Podcast episodes count in recaps. */
  podcasts: boolean;
}

export const DEFAULT_RECAP: RecapSettings = { localLog: true, games: "sometimes", autoAdvance: true, podcasts: false };

export function normalizeRecap(v: unknown): RecapSettings {
  const s = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof RecapSettings, unknown>>;
  return {
    localLog: s.localLog !== false,
    games: s.games === "always" || s.games === "never" ? s.games : "sometimes",
    autoAdvance: s.autoAdvance !== false,
    podcasts: s.podcasts === true,
  };
}
