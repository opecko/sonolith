// Google Takeout's YouTube watch history (watch-history.json) as Recaps plays: every YouTube Music play with its exact
// time, as far back as the account's history goes. Only the JSON format is read (Takeout's default is HTML; the
// format is picked under "Multiple formats"). Unknown shapes are skipped, never thrown on. Nothing here is sent
// anywhere: the file is read in the app and kept in the recap folder.

/** One YouTube Music play from Takeout. Takeout has no length, album or cover; merge.ts borrows them when known. */
export interface TakeoutPlay {
  videoId: string;
  title: string;
  artist: string;
  /** Channel id of the byline (often the artist's " - Topic" channel), when given. */
  artistId: string | null;
  /** Epoch ms. */
  at: number;
}

export interface TakeoutCache {
  version: 1;
  importedAt: number;
  plays: TakeoutPlay[];
}

export const EMPTY_TAKEOUT: TakeoutCache = { version: 1, importedAt: 0, plays: [] };

export type TakeoutResult =
  | { ok: true; plays: TakeoutPlay[]; skipped: number; youtubeOnly: number }
  | { ok: false; reason: "html" | "notHistory" };

// "Watched X" in the account's language; titles without a known prefix stay as they are.
const PREFIXES = /^(Watched|Zhlédnuto:?|Shlédnuto:?|Pozrité:?|Angesehen:?|Visto:?|Regardé:?|Vu:?|Obejrzano:?|Bekeken:?|Guardato:?|Assistiu a|Assistido:?|Visualizzato:?|Megnézte:?|Просмотрено:?|Переглянуто:?)\s+/i;

const VIDEO_ID = /[?&]v=([\w-]{11})/;
const CHANNEL_ID = /\/channel\/(UC[\w-]{22})/;

/** Parses the text of watch-history.json. YouTube (not Music) entries are counted but left out. */
export function parseTakeout(text: string): TakeoutResult {
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return { ok: false, reason: "html" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "notHistory" };
  }
  if (!Array.isArray(data)) return { ok: false, reason: "notHistory" };
  const plays: TakeoutPlay[] = [];
  let skipped = 0, youtubeOnly = 0, recognized = 0;
  for (const e of data as Record<string, unknown>[]) {
    if (!e || typeof e !== "object" || typeof e.time !== "string" || typeof e.header !== "string") {
      skipped++;
      continue;
    }
    recognized++;
    if (e.header !== "YouTube Music") {
      youtubeOnly++;
      continue;
    }
    const id = typeof e.titleUrl === "string" ? VIDEO_ID.exec(e.titleUrl)?.[1] : undefined;
    const at = Date.parse(e.time);
    // Removed videos come without a link; they can't be matched to anything.
    if (!id || !Number.isFinite(at) || typeof e.title !== "string") {
      skipped++;
      continue;
    }
    const sub = Array.isArray(e.subtitles) ? (e.subtitles[0] as { name?: unknown; url?: unknown } | undefined) : undefined;
    const artist = typeof sub?.name === "string" ? sub.name.replace(/\s*-\s*Topic$/i, "") : "";
    plays.push({
      videoId: id,
      title: e.title.replace(PREFIXES, "").trim() || e.title,
      artist,
      artistId: typeof sub?.url === "string" ? CHANNEL_ID.exec(sub.url)?.[1] ?? null : null,
      at,
    });
  }
  if (!recognized) return { ok: false, reason: "notHistory" };
  plays.sort((a, b) => a.at - b.at);
  return { ok: true, plays, skipped, youtubeOnly };
}

/** Adds a new export to the stored one: the same play (video and time) is kept once, so re-imports are safe. */
export function mergeTakeout(cache: TakeoutCache, plays: TakeoutPlay[], now: number): TakeoutCache {
  const byKey = new Map(cache.plays.map((p) => [`${p.videoId}|${p.at}`, p]));
  for (const p of plays) byKey.set(`${p.videoId}|${p.at}`, p);
  return { version: 1, importedAt: now, plays: [...byKey.values()].sort((a, b) => a.at - b.at) };
}

export function parseTakeoutCache(v: unknown): TakeoutCache {
  const c = v as TakeoutCache;
  if (!c || c.version !== 1 || !Array.isArray(c.plays)) return EMPTY_TAKEOUT;
  return {
    version: 1,
    importedAt: Number.isFinite(c.importedAt) ? c.importedAt : 0,
    plays: c.plays.filter((p) => p && typeof p.videoId === "string" && typeof p.title === "string" && Number.isFinite(p.at)),
  };
}
