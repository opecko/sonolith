import { type Album, type Rating, type AlbumRef, type Artist, type ArtistRef, type Item, type PlaylistRef, type Shelf, type Track } from "./types";

// Parsed youtubei.js nodes are accessed structurally: unknown node types must never throw.
type N = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const arr = (v: unknown): N[] => (Array.isArray(v) ? v : []);

export function text(t: N): string {
  if (typeof t === "string") return t;
  if (typeof t?.text === "string") return t.text;
  return arr(t?.runs).map((r) => r?.text ?? "").join("");
}

export function pickThumb(t: N, minWidth = 200): string | undefined {
  const list: N[] = Array.isArray(t) ? t : arr(t?.contents);
  const usable = list.filter((x) => typeof x?.url === "string");
  const sized = usable.find((x) => (x.width ?? 0) >= minWidth);
  return (sized ?? usable[usable.length - 1])?.url;
}

const names = (list: N): string[] => arr(list).map((a) => a?.name).filter((n): n is string => !!n);
const stripVL = (id: string) => (id.startsWith("VL") ? id.slice(2) : id);

function nonEmpty(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" • ");
}

function likeStatus(menu: N): Rating | undefined {
  const status = arr(menu?.top_level_buttons).find((b) => b?.type === "LikeButton")?.like_status;
  return status === "LIKE" || status === "DISLIKE" || status === "INDIFFERENT" ? status : undefined;
}

interface TrackFallback { thumbnail?: string; artists?: string[]; artistIds?: (string | undefined)[]; album?: { id?: string; title: string } }

export function mapTrack(n: N, fallback: TrackFallback = {}): Track | null {
  const id = n?.id ?? n?.video_id;
  const title = n?.title ? text(n.title) : "";
  if (!id || !title) return null;
  const people: N[] = names(n.artists).length ? arr(n.artists) : names(n.authors).length ? arr(n.authors) : [];
  const artists = people.length ? names(people) : fallback.artists ?? [];
  const ids = people.length
    ? people.filter((a) => a?.name).map((a): string | undefined => a.channel_id ?? a.endpoint?.payload?.browseId)
    : fallback.artistIds ?? [];
  const album = n.album?.name ? { id: n.album.id, title: n.album.name } : fallback.album;
  return {
    type: "track",
    id,
    title,
    subtitle: nonEmpty(artists.join(", ") || n.author?.name, album?.title),
    thumbnail: pickThumb(n.thumbnail) ?? fallback.thumbnail,
    artists,
    ...(ids.some(Boolean) ? { artistIds: ids } : {}),
    album,
    durationSec: typeof n.duration?.seconds === "number" ? n.duration.seconds : undefined,
    rating: likeStatus(n.menu),
    ...(n.item_type === "video" ? { video: true } : {}),
  };
}

function ref(type: "album" | "playlist" | "artist", id: string | undefined, title: string, subtitle: string, thumb: N) {
  if (!id || !title) return null;
  return { type, id: type === "playlist" ? stripVL(id) : id, title, subtitle, thumbnail: pickThumb(thumb) } as AlbumRef | PlaylistRef | ArtistRef;
}

function mapTwoRow(n: N): Item | null {
  const title = text(n.title);
  const subtitle = text(n.subtitle);
  switch (n.item_type) {
    case "album":
    case "playlist":
    case "artist":
      return ref(n.item_type, n.id, title, subtitle, n.thumbnail);
    case "song":
    case "video":
      return mapTrack({ ...n, artists: n.artists ?? (n.author ? [n.author] : []) });
    case "endpoint": {
      const playlistId = n.endpoint?.payload?.playlistId;
      return playlistId ? ref("playlist", playlistId, title, subtitle, n.thumbnail) : null;
    }
    default:
      return null;
  }
}

function mapResponsive(n: N): Item | null {
  const title = text(n.title ?? n.name);
  switch (n.item_type) {
    case "song":
    case "video":
    case "non_music_track":
      return mapTrack(n);
    case "album":
      return ref("album", n.id, title, nonEmpty(n.author?.name ?? names(n.artists).join(", "), n.year), n.thumbnail);
    case "playlist":
      return ref("playlist", n.id, title, nonEmpty(n.author?.name, n.item_count), n.thumbnail);
    case "artist":
    case "library_artist":
      return ref("artist", n.id, title, n.subscribers ?? n.song_count ?? "", n.thumbnail);
    default:
      return null;
  }
}

export function mapItem(n: N): Item | null {
  try {
    if (n?.type === "MusicTwoRowItem") return mapTwoRow(n);
    if (n?.type === "MusicResponsiveListItem") return mapResponsive(n);
  } catch {
    return null;
  }
  return null;
}

export function mapItems(list: N): Item[] {
  return arr(list).map(mapItem).filter((x): x is Item => x !== null);
}

export function mapShelf(n: N): Shelf | null {
  let title = "";
  let list: N;
  switch (n?.type) {
    case "MusicCarouselShelf":
      title = text(n.header?.title);
      list = n.contents;
      break;
    case "MusicShelf":
    case "MusicShelfContinuation":
    case "MusicPlaylistShelf":
      title = text(n.title);
      list = n.contents;
      break;
    case "MusicCardShelf":
      title = "Top result";
      list = [...arr(n.contents)];
      break;
    case "Grid":
    case "GridContinuation":
      list = n.items;
      break;
    default:
      return null;
  }
  const items = mapItems(list);
  return items.length ? { title, items } : null;
}

export function mapShelves(list: N): Shelf[] {
  return arr(list).map(mapShelf).filter((x): x is Shelf => x !== null);
}

export interface Header {
  title: string;
  subtitle: string;
  thumbnail?: string;
}

export function mapHeader(h: N): Header {
  const node = h?.header ?? h;
  return {
    title: text(node?.title),
    subtitle: nonEmpty(text(node?.subtitle), text(node?.second_subtitle)),
    thumbnail: pickThumb(node?.thumbnails ?? node?.thumbnail),
  };
}

export function mapTracks(list: N, fallback?: TrackFallback): Track[] {
  return arr(list)
    .filter((n) => n?.type === "MusicResponsiveListItem")
    .map((n) => mapTrack(n, fallback))
    .filter((x): x is Track => x !== null);
}

/**
 * An album's artists, for its tracks (album rows carry none): the header's strapline ("Artist A & Artist B", each a
 * link with its browse id). Older headers put the artist in the subtitle ("Album • Artist • 2020"); the year or the
 * type there is never taken for one.
 */
export function albumArtists(header: N): { artists: string[]; artistIds: (string | undefined)[] } {
  const node = header?.header ?? header;
  const runs = arr(node?.strapline_text_one?.runs).filter((r) => typeof r?.text === "string" && !/^[\s,&•·]*$/.test(r.text));
  const linked = runs.filter((r) => r.endpoint?.payload?.browseId);
  if (linked.length) return { artists: linked.map((r) => r.text.trim()), artistIds: linked.map((r) => r.endpoint.payload.browseId) };
  const strap = text(node?.strapline_text_one).trim();
  if (strap) return { artists: [strap], artistIds: [] };
  const fromSubtitle = text(node?.subtitle).split(" • ").slice(1).find((p) => p && !/^\d{4}$/.test(p.trim()));
  return { artists: fromSubtitle ? [fromSubtitle.trim()] : [], artistIds: [] };
}

export function mapAlbum(id: string, page: N): Album {
  const h = mapHeader(page?.header);
  const { artists, artistIds } = albumArtists(page?.header);
  return {
    type: "album",
    id,
    ...h,
    tracks: mapTracks(page?.contents, { thumbnail: h.thumbnail, artists, artistIds, album: h.title ? { id, title: h.title } : undefined }),
    related: mapShelves(page?.sections),
  };
}

export function mapArtist(id: string, page: N): Artist {
  const h = page?.header;
  return {
    type: "artist",
    id,
    title: text(h?.title),
    subtitle: "",
    thumbnail: pickThumb(h?.thumbnail) ?? pickThumb(h?.foreground_thumbnail),
    shelves: mapShelves(page?.sections),
  };
}
