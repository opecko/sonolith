// The app's data (api/types.ts, stores) → the local API's types (schema.gen.ts, api/SPEC.md). Pure.
import { hiResArt } from "../api/art";
import type { Album as AppAlbum, Artist as AppArtist, Item as AppItem, Rating as AppRating, Shelf, Track as AppTrack } from "../api/types";
import { PROVIDER_NAMES } from "../lyrics/providers";
import { tierOf, type LyricsData } from "../lyrics/pick";
import type * as A from "./schema.gen";

/** What the caller may see and what the app knows beyond the item itself. */
export interface Ctx {
  /** `library:read` granted: ratings and episode progress are filled in, otherwise null. */
  library: boolean;
  /** The rating known this session (player store), else the item's own. */
  rating?: (id: string) => AppRating | undefined;
  /** Local episode progress (stores/episodeProgress.ts): played flag and resume position in seconds. */
  episode?: (id: string) => { played: boolean; resumeSec: number } | undefined;
}

const RATING: Record<AppRating, A.Rating> = { LIKE: "like", DISLIKE: "dislike", INDIFFERENT: "none" };
export const APP_RATING: Record<A.Rating, AppRating> = { like: "LIKE", dislike: "DISLIKE", none: "INDIFFERENT" };

const ms = (sec: number | undefined) => (sec === undefined || !Number.isFinite(sec) ? null : Math.max(0, Math.round(sec * 1000)));
const parts = (subtitle: string) => subtitle.split(" • ").map((p) => p.trim()).filter(Boolean);

/** The largest artwork as an absolute HTTPS URL (video frames stay as they are: max-res frames can be missing). */
export function thumb(url: string | undefined): string | null {
  if (!url) return null;
  const abs = url.startsWith("//") ? `https:${url}` : url;
  return /^https:\/\//.test(abs) ? hiResArt(abs) ?? abs : null;
}

/** Label words YouTube puts first in subtitles, never names. */
const LABELS = /^(song|video|episode|album|single|ep|playlist|podcast|artist|profile)$/i;

function artistCredits(t: AppTrack): A.ArtistCredit[] {
  return t.artists
    .map((name, i) => ({ id: t.artistIds?.[i] ?? null, name }))
    .filter((a) => a.name && !(a.id === null && (LABELS.test(a.name) || a.name === (t as AppItem).kind)));
}

export function track(t: AppTrack, ctx: Ctx): A.Track {
  const rating = ctx.rating?.(t.id) ?? t.rating;
  return {
    type: "track",
    id: t.id,
    title: t.title,
    artists: artistCredits(t),
    album: t.album ? { id: t.album.id ?? null, title: t.album.title } : null,
    durationMs: ms(t.durationSec),
    thumbnailUrl: thumb(t.thumbnail),
    explicit: !!t.explicit,
    video: !!t.video || (t as AppItem).art === "wide",
    rating: ctx.library ? (rating ? RATING[rating] : "none") : null,
  };
}

export function episode(t: AppTrack, ctx: Ctx): A.Episode {
  const local = ctx.episode?.(t.id);
  const server = t.episode?.progress;
  const sub = parts(t.subtitle);
  return {
    type: "episode",
    id: t.id,
    title: t.title,
    podcast: t.show ? { id: t.show.id, title: t.show.title } : null,
    author: t.show?.title ?? (sub.length > 1 ? sub[sub.length - 1] : null),
    durationMs: ms(t.durationSec),
    thumbnailUrl: thumb(t.thumbnail),
    publishedText: t.episode?.published ?? (sub.length > 1 ? sub[0] : null),
    played: ctx.library ? (local?.played ?? server?.played ?? false) : null,
    resumePositionMs: !ctx.library ? null : local ? ms(local.resumeSec) : server && !server.played && t.durationSec ? ms((t.durationSec * server.percent) / 100) : 0,
  };
}

export const mediaItem = (t: AppTrack, ctx: Ctx): A.MediaItem => (t.podcast ? episode(t, ctx) : track(t, ctx));

/** "Single • Nightly • 2023" → type, artists, year. */
function albumBits(subtitle: string, kind?: string) {
  const p = parts(subtitle);
  const year = p.map(Number).find((n) => Number.isInteger(n) && n > 1800 && n < 3000) ?? null;
  const label = (kind ?? p[0] ?? "").toLowerCase();
  const albumType: A.Album["albumType"] = label === "album" ? "album" : label === "single" ? "single" : label === "ep" ? "ep" : null;
  const names = p.filter((x) => !LABELS.test(x) && String(year) !== x);
  return { year, albumType, artists: names.map((name) => ({ id: null, name })) };
}

export function album(i: { id: string; title: string; subtitle: string; thumbnail?: string; kind?: string }, artists?: A.ArtistCredit[]): A.Album {
  const b = albumBits(i.subtitle, i.kind);
  return {
    type: "album",
    id: i.id,
    title: i.title,
    artists: artists ?? b.artists,
    albumType: b.albumType,
    year: b.year,
    thumbnailUrl: thumb(i.thumbnail),
    explicit: false,
  };
}

/** Own playlists show just a count; auto playlists and mixes (LM, RD…, SE) can't be edited. */
export function playlist(i: { id: string; title: string; subtitle: string; thumbnail?: string }): A.Playlist {
  const p = parts(i.subtitle);
  const countPart = p.find((x) => /^\d[\d,]* (tracks?|songs?|episodes?|videos?)$/i.test(x));
  const count = countPart ? Number(countPart.replace(/[^\d]/g, "")) : null;
  const author = p.find((x) => x !== countPart && !LABELS.test(x) && !/views?$/.test(x)) ?? null;
  const auto = i.id === "LM" || i.id === "SE" || i.id.startsWith("RD");
  return {
    type: "playlist",
    id: i.id,
    title: i.title,
    author,
    trackCount: count,
    thumbnailUrl: thumb(i.thumbnail),
    editable: auto ? false : countPart && p.length === 1 ? true : author ? false : null,
  };
}

export function artist(i: { id: string; title: string; subtitle: string; thumbnail?: string }): A.Artist {
  return {
    type: "artist",
    id: i.id,
    name: i.title,
    thumbnailUrl: thumb(i.thumbnail),
    subscribersText: parts(i.subtitle).find((x) => /subscriber|monthly audience/i.test(x)) ?? null,
  };
}

export function podcast(i: { id: string; title: string; subtitle: string; thumbnail?: string }): A.Podcast {
  const author = parts(i.subtitle).find((x) => !LABELS.test(x) && !/episodes?$/.test(x)) ?? null;
  return { type: "podcast", id: i.id, title: i.title, author, thumbnailUrl: thumb(i.thumbnail) };
}

/** Any listed item; user channels (podcast creators) have no API type and are left out. */
export function item(i: AppItem, ctx: Ctx, forceVideo = false): A.Item | null {
  switch (i.type) {
    case "track": {
      const m = mediaItem(i, ctx);
      return forceVideo && m.type === "track" ? { ...m, video: true } : m;
    }
    case "album":
      return album(i);
    case "playlist":
      return i.podcast ? podcast(i) : playlist(i);
    case "artist":
      return i.channel ? null : artist(i);
  }
}

export const items = (list: AppItem[], ctx: Ctx, forceVideo = false): A.Item[] =>
  list.map((i) => item(i, ctx, forceVideo)).filter((i): i is A.Item => i !== null);

export function albumDetail(a: AppAlbum, ctx: Ctx): A.AlbumDetail {
  const first = a.tracks[0];
  const credits = first ? artistCredits(first) : undefined;
  const tracks = a.tracks.map((t) => track(t, ctx));
  const total = a.tracks.every((t) => t.durationSec !== undefined) ? a.tracks.reduce((s, t) => s + (t.durationSec ?? 0), 0) : undefined;
  return {
    ...album(a, credits?.length ? credits : undefined),
    explicit: a.tracks.some((t) => t.explicit),
    description: null,
    trackCount: tracks.length,
    durationMs: ms(total),
    tracks,
  };
}

const SECTION_KINDS: [RegExp, A.ArtistSection["kind"]][] = [
  [/^(top )?songs$/i, "songs"],
  [/^albums$/i, "albums"],
  [/^singles/i, "singles"],
  [/videos$/i, "videos"],
  [/playlists|featured on/i, "playlists"],
  [/episodes/i, "episodes"],
  [/fans might also like|related|similar/i, "related"],
];

export function artistDetail(a: AppArtist, ctx: Ctx): A.ArtistDetail {
  const sections = a.shelves
    .map((s: Shelf): A.ArtistSection => ({
      kind: SECTION_KINDS.find(([re]) => re.test(s.title))?.[1] ?? "other",
      title: s.title,
      items: items(s.items, ctx, /videos$/i.test(s.title)),
    }))
    .filter((s) => s.title && s.items.length);
  return { ...artist(a), description: null, sections };
}

// ---------------------------------------------------------------- lyrics

export function lyricsResult(trackId: string, d: LyricsData | null): A.LyricsResult {
  if (!d || (!d.lines.length && !d.plain)) return { trackId, status: "notFound", lyrics: null };
  const tier = tierOf(d);
  const word = (w: { start: number; end: number; text: string }): A.LyricWord => ({ startMs: Math.round(w.start), endMs: Math.round(w.end), text: w.text });
  const lines: A.LyricLine[] = d.synced
    ? d.lines.map((l) => ({
        startMs: Math.round(l.start),
        endMs: l.end === undefined ? null : Math.round(l.end),
        text: l.text,
        words: tier === "word-synced" ? (l.words ?? []).map(word) : [],
        background: tier === "word-synced" ? (l.background ?? []).map(word) : [],
      }))
    : (d.plain ?? d.lines.map((l) => l.text).join("\n")).split("\n").map((text) => ({ startMs: null, endMs: null, text, words: [], background: [] }));
  return {
    trackId,
    status: "found",
    lyrics: {
      trackId,
      tier: tier === "word-synced" ? "word" : tier === "line-synced" ? "line" : "unsynced",
      provider: d.provider,
      providerName: PROVIDER_NAMES[d.provider],
      attribution: d.source ?? null,
      lines,
    },
  };
}
