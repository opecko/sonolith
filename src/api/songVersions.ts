// Songs instead of music videos in YouTube Music's own playlists. Without Premium (and signed out) YouTube serves
// those playlists with each song's music video ("Let It Happen (Official Video)", the video's length); Premium gets
// the songs. Each video is matched to its song by a songs-only search on its title and artists.
import type { Track } from "./types";

/** YouTube Music's own (editorial) playlists, e.g. "Presenting Tame Impala"; user playlists keep what was added. */
export const isEditorialPlaylist = (id: string) => /^(VL)?RDCLAK/.test(id);

/** The video's title as a search query: without "(Official Video)", "[Lyric Video]" and the like. */
export function searchTitle(title: string): string {
  return title.replace(/\s*[([][^)\]]*\b(official|video|audio|lyrics?|visuali[sz]er)\b[^)\]]*[)\]]/gi, "").trim() || title;
}

/** The bare title for comparing: no bracketed parts (feat., Live from …, Official Video), letters and digits only. */
export function baseTitle(title: string): string {
  return title.replace(/\s*[([][^)\]]*[)\]]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * The song for a video among search results: same bare title and at least one shared artist. The closest title
 * wins: the exact one, then the shortest (a studio "Dracula" over "Dracula (feat. JENNIE)" for a live video).
 */
export function pickSong(video: Track, candidates: Track[]): Track | undefined {
  const base = baseTitle(video.title);
  const artists = new Set(video.artists.map((a) => a.toLowerCase()));
  const fits = candidates.filter((c) => !c.video && c.id !== video.id && baseTitle(c.title) === base && c.artists.some((a) => artists.has(a.toLowerCase())));
  const wanted = searchTitle(video.title).toLowerCase();
  return fits.find((c) => c.title.toLowerCase() === wanted) ?? [...fits].sort((a, b) => a.title.length - b.title.length)[0];
}

const CACHE_KEY = "songVersions-v1";
const CACHE_MAX = 2000;
let cache: Map<string, Track | null> | null = null;

function loadCache(): Map<string, Track | null> {
  if (cache) return cache;
  try {
    cache = new Map(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as [string, Track | null][]);
  } catch {
    cache = new Map();
  }
  return cache;
}

function saveCache() {
  try {
    const entries = [...loadCache()].slice(-CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    /* storage unavailable or full: the matches are only a speed-up */
  }
}

/**
 * Replaces each music video with its song where one is found (a few searches at a time, results cached by video
 * id, misses too). Anything that can't be matched, or whose search fails, stays as it was.
 */
export async function songVersions(tracks: Track[], searchSongs: (query: string) => Promise<Track[]>, parallel = 6): Promise<Track[]> {
  const known = loadCache();
  const todo = [...new Set(tracks.filter((t) => t.video && !known.has(t.id)).map((t) => t.id))];
  const byId = new Map(tracks.map((t) => [t.id, t]));
  let changed = false;
  const worker = async () => {
    for (let id = todo.shift(); id; id = todo.shift()) {
      const v = byId.get(id)!;
      try {
        const song = pickSong(v, await searchSongs(`${searchTitle(v.title)} ${v.artists.join(" ")}`));
        known.set(id, song ? { ...song, menu: undefined } : null);
        changed = true;
      } catch {
        /* left as the video; tried again next time */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, todo.length) }, worker));
  if (changed) saveCache();
  return tracks.map((t) => (t.video && known.get(t.id)) || t);
}
