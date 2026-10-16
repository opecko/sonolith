import type { WhatsNewEntry } from "./types";

/** "v1.2.3" / "1.2.3-beta" → [1, 2, 3]; null when it isn't a version. Pre-release and build suffixes are ignored. */
export function parseVersion(v: string): number[] | null {
  const core = v.trim().replace(/^v/, "").split(/[-+]/)[0];
  const parts = core.split(".");
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map(Number);
}

/** Numeric comparison (1.10.0 > 1.9.0, 2.0.0 > 1.3.0); missing parts count as 0. Unparsable versions compare equal. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export const entryFor = (version: string, entries: WhatsNewEntry[]) =>
  entries.find((e) => compareVersions(e.version, version) === 0 && parseVersion(e.version) !== null) ?? null;

/**
 * What to do on startup. `lastSeen` is the version whose What's new was handled; `freshInstall` = there were no
 * stored settings at all. Settings from before 2.0 have no `lastSeen` but aren't a fresh install: they count as
 * coming from an older version. Returns the entry to show (or null) and the version to save (or null = no change).
 */
export function pickWhatsNew(appVersion: string, lastSeen: string | null, freshInstall: boolean, entries: WhatsNewEntry[]):
  { show: WhatsNewEntry | null; save: string | null } {
  if (!parseVersion(appVersion)) return { show: null, save: null };
  if (lastSeen === null && freshInstall) return { show: null, save: appVersion };
  if (lastSeen !== null && compareVersions(appVersion, lastSeen) === 0) return { show: null, save: null };
  const newer = lastSeen === null || compareVersions(appVersion, lastSeen) > 0;
  return { show: newer ? entryFor(appVersion, entries) : null, save: appVersion };
}
