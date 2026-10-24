// Defensive parsers for raw InnerTube (WEB_REMIX) JSON. Unknown nodes are skipped, never thrown on.
import { parseTrackMenu } from "./menu";
import type { BrowsePage, BrowseRef, CardAction, Chip, Continuation, EpisodeInfo, Item, Rating, Shelf, Track } from "./types";

type R = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const arr = (v: unknown): R[] => (Array.isArray(v) ? v : []);
const SEP = " • ";

const seen = new Set<string>();
/** Logs each unknown renderer name once (dev only). */
export function unknownNode(n: R, where: string) {
  const key = `${where}:${n && typeof n === "object" ? Object.keys(n)[0] : typeof n}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (import.meta.env?.DEV) console.debug(`[ytm] skipped node ${key}`);
}

export function runsText(t: R): string {
  if (!t) return "";
  if (typeof t === "string") return t;
  if (typeof t.simpleText === "string") return t.simpleText;
  if (typeof t.content === "string") return t.content;
  return arr(t.runs).map((r) => r?.text ?? "").join("");
}

export function bestThumb(list: R, minWidth = 226): string | undefined {
  const thumbs = arr(list).filter((t) => t?.url);
  if (!thumbs.length) return undefined;
  const sorted = [...thumbs].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const url: string = (sorted.find((t) => (t.width ?? 0) >= minWidth) ?? sorted[sorted.length - 1]).url;
  // googleusercontent art can be resized via the =wN-hN suffix.
  return url.replace(/=w\d+-h\d+(-[a-z0-9-]+)?$/i, `=w${minWidth * 2}-h${minWidth * 2}-l90-rj`);
}

const thumbsOf = (n: R) =>
  n?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
  n?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
  n?.thumbnail?.thumbnails;

export const pageType = (ep: R): string => ep?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? "";
const stripPrefix = (id: string, prefix: string) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);

export function parseDuration(s: string): number | undefined {
  if (!/^\d+(:\d{1,2}){1,2}$/.test(s.trim())) return undefined;
  return s.trim().split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
}

interface RunInfo { artists: string[]; artistIds: (string | undefined)[]; album?: { id?: string; title: string }; show?: { id: string; title: string }; label?: string }
export function runInfo(runs: R[]): RunInfo {
  const info: RunInfo = { artists: [], artistIds: [] };
  for (const r of runs) {
    const pt = pageType(r?.navigationEndpoint);
    if (pt === "MUSIC_PAGE_TYPE_ARTIST" || pt === "MUSIC_PAGE_TYPE_USER_CHANNEL") {
      info.artists.push(r.text);
      info.artistIds.push(r.navigationEndpoint?.browseEndpoint?.browseId);
    } else if (pt === "MUSIC_PAGE_TYPE_ALBUM") info.album = { id: r.navigationEndpoint.browseEndpoint.browseId, title: r.text };
    else if (pt === "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE") info.show = { id: stripPrefix(r.navigationEndpoint.browseEndpoint.browseId, "MPSP"), title: r.text };
  }
  return info;
}

export const asRating = (s: unknown): Rating | undefined =>
  s === "LIKE" || s === "DISLIKE" || s === "INDIFFERENT" ? s : undefined;

const likeStatusOf = (n: R): Rating | undefined => {
  for (const b of arr(n?.menu?.menuRenderer?.topLevelButtons)) {
    const s = asRating(b?.likeButtonRenderer?.likeStatus);
    if (s) return s;
  }
  return undefined;
};

function refFromBrowse(ep: R, title: string, subtitle: string, thumbnail?: string): Item | null {
  const id: string | undefined = ep?.browseEndpoint?.browseId;
  if (!id) return null;
  switch (pageType(ep)) {
    case "MUSIC_PAGE_TYPE_ALBUM":
    case "MUSIC_PAGE_TYPE_AUDIOBOOK":
      return { type: "album", id, title, subtitle, thumbnail };
    case "MUSIC_PAGE_TYPE_ARTIST":
    case "MUSIC_PAGE_TYPE_LIBRARY_ARTIST":
      return { type: "artist", id: stripPrefix(id, "MPLA"), title, subtitle, thumbnail, art: "round" };
    case "MUSIC_PAGE_TYPE_USER_CHANNEL":
      return { type: "artist", id, title, subtitle, thumbnail, art: "round", channel: true };
    case "MUSIC_PAGE_TYPE_PLAYLIST":
      return { type: "playlist", id: stripPrefix(id, "VL"), title, subtitle, thumbnail };
    case "MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE":
      return { type: "playlist", id: stripPrefix(id, "MPSP"), title, subtitle, thumbnail, podcast: true };
    case "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE":
      return { type: "track", id: stripPrefix(id, "MPED"), title, subtitle, thumbnail, artists: [], podcast: true };
    default:
      return null;
  }
}

const isSep = (t: string) => /^\s*[•·]\s*$/.test(t);
const EPISODE_PAGE = "MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE";
const isPodcastType = (mvt: string) => /PODCAST/.test(mvt);

/**
 * A row / card is an episode when its title links to an episode page, its video type says podcast, or its byline
 * links a podcast show. Its byline then reads "Episode • Dec 5, 2024 • Show": no artists, no album.
 */
function asEpisode(t: Track & Item, runs: R[], info: RunInfo) {
  t.podcast = true;
  t.artists = [];
  delete t.artistIds;
  delete t.album;
  if (info.show) t.show = info.show;
  // Plain runs other than the leading label: the publish date (and occasionally a duration).
  const plain = runs.filter((r, i) => !r?.navigationEndpoint && r?.text && !isSep(r.text) && !(i === 0 && runs.length > 1)).map((r) => String(r.text).trim());
  const published = plain.find((p) => !parseDuration(p));
  const duration = plain.map(parseDuration).find((d) => d !== undefined);
  if (duration !== undefined && t.durationSec === undefined) t.durationSec = duration;
  t.episode = { ...t.episode, ...(published && { published }) };
  t.subtitle = [published, info.show?.title].filter(Boolean).join(" • ") || t.subtitle;
  t.kind = t.kind ?? runs[0]?.text;
}

function mapTwoRow(n: R): Item | null {
  const title = runsText(n.title);
  const subRuns = arr(n.subtitle?.runs);
  const subtitle = runsText(n.subtitle);
  const thumbnail = bestThumb(thumbsOf(n));
  const nav = n.navigationEndpoint ?? n.title?.runs?.[0]?.navigationEndpoint;
  if (!title || nav?.createPlaylistEndpoint) return null;
  const wide = /RECTANGLE|16_9/.test(n.aspectRatio ?? "");
  const watch = nav?.watchEndpoint;
  if (watch?.videoId) {
    const info = runInfo(subRuns);
    const t: Track & Item = { type: "track", id: watch.videoId, title, subtitle, thumbnail, artists: info.artists, artistIds: info.artistIds, album: info.album, kind: subRuns[0]?.text };
    if (wide) t.art = "wide";
    if (isPodcastType(watch.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? "") || info.show) asEpisode(t, subRuns, info);
    return t;
  }
  const playlistId: string | undefined = nav?.watchPlaylistEndpoint?.playlistId;
  if (playlistId) return { type: "playlist", id: playlistId, title, subtitle, thumbnail };
  const ref = refFromBrowse(nav, title, subtitle, thumbnail);
  if (ref && ref.type !== "artist" && !ref.kind && subRuns[0]?.text && !subRuns[0]?.navigationEndpoint) ref.kind = subRuns[0].text;
  return ref;
}

const watchOf = (n: R) =>
  n?.navigationEndpoint?.watchEndpoint ?? n?.onTap?.watchEndpoint ??
  n?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint ??
  n?.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint;

const CARD_ICONS: Record<string, CardAction["kind"]> = { MUSIC_SHUFFLE: "shuffle", MIX: "mix", PLAY_ARROW: "play", PLAYLIST_ADD: "save" };

/** Shuffle / Mix / Play / Save buttons of the search top-result card. */
function cardActions(n: R): CardAction[] {
  return arr(n.buttons).flatMap((b: R): CardAction[] => {
    const r = b?.buttonRenderer;
    const kind = CARD_ICONS[r?.icon?.iconType];
    if (!kind) return [];
    const cmd = r.command ?? r.navigationEndpoint ?? {};
    const w = cmd.watchPlaylistEndpoint ?? cmd.watchEndpoint ?? cmd.addToPlaylistEndpoint ?? {};
    const a: CardAction = { kind, label: runsText(r.text) || kind };
    if (w.playlistId) a.playlistId = w.playlistId;
    if (w.params) a.params = w.params;
    if (w.videoId) a.videoId = w.videoId;
    return kind === "save" || a.playlistId || a.videoId ? [a] : [];
  });
}

/** Search "top result" card: the card itself plus its inline items (top songs etc.). */
function mapCard(n: R): Item[] {
  const title = runsText(n.title);
  const subRuns = arr(n.subtitle?.runs);
  const subtitle = runsText(n.subtitle);
  const thumbnail = bestThumb(thumbsOf(n), 300);
  const nav = n.title?.runs?.[0]?.navigationEndpoint ?? n.onTap;
  let top: Item | null = refFromBrowse(nav, title, subtitle, thumbnail);
  const watch = nav?.watchEndpoint ?? watchOf(n);
  if (!top && watch?.videoId) {
    const info = runInfo(subRuns);
    top = { type: "track", id: watch.videoId, title, subtitle, thumbnail, artists: info.artists, artistIds: info.artistIds, album: info.album, kind: subRuns[0]?.text };
    const mvt = watch.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? "";
    if (isPodcastType(mvt) || info.show) asEpisode(top as Track & Item, subRuns, info);
    else if (mvt && !/ATV|OFFICIAL_SOURCE_MUSIC|PRIVATELY_OWNED/.test(mvt)) top.art = "wide";
    if (JSON.stringify(n.subtitleBadges ?? []).includes("EXPLICIT")) top.explicit = true;
  }
  if (top && top.type !== "artist" && !top.kind) top.kind = subRuns[0]?.text;
  // Songs on an artist card have no artist/album runs ("Song • 3:44 • 130M plays"); the player fills them in
  // from /next once one plays.
  return [top, ...mapRawItems(n.contents)].filter((i): i is Item => !!i);
}

const flexRuns = (n: R, i: number): R[] => arr(n.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs);

function mapResponsive(n: R): Item | null {
  const titleRuns = flexRuns(n, 0);
  const title = titleRuns.map((r) => r?.text ?? "").join("");
  if (!title) return null;
  const thumbnail = bestThumb(thumbsOf(n), 120);
  const restRuns = arr(n.flexColumns).slice(1).flatMap((_: R, i: number) => flexRuns(n, i + 1));
  const subtitle = arr(n.flexColumns)
    .slice(1)
    .map((_: R, i: number) => flexRuns(n, i + 1).map((r) => r?.text ?? "").join(""))
    .filter(Boolean)
    .join(SEP);
  // Albums/playlists/artists in lists navigate via browse and only carry a play overlay; don't treat them as tracks.
  if (!n.playlistItemData && n.navigationEndpoint?.browseEndpoint && !titleRuns[0]?.navigationEndpoint?.watchEndpoint) {
    const ref = refFromBrowse(n.navigationEndpoint, title, subtitle, thumbnail);
    if (ref) {
      const label = flexRuns(n, 1);
      if (!ref.kind && ref.type !== "artist" && label.length > 1 && !label[0]?.navigationEndpoint) ref.kind = label[0]?.text;
      return ref;
    }
  }
  const videoId: string | undefined =
    n.playlistItemData?.videoId ??
    titleRuns[0]?.navigationEndpoint?.watchEndpoint?.videoId ??
    n.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (videoId) {
    const info = runInfo(restRuns);
    const fixed = runsText(n.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
    const musicVideoType = titleRuns[0]?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ?? "";
    const isSongish = /ATV|OFFICIAL_SOURCE_MUSIC|PRIVATELY_OWNED/.test(musicVideoType) || !musicVideoType;
    // The length is the fixed column, or a run of its own: last in lists, before "11M plays" in search results.
    const durationSec = parseDuration(fixed) ?? restRuns.map((r: R) => parseDuration(r?.text ?? "")).reverse().find((d) => d !== undefined);
    const artists = info.artists.length ? info.artists : [runsText({ runs: flexRuns(n, 1) }).split(SEP)[0]].filter(Boolean);
    const t: Track & Item = { type: "track", id: videoId, title, subtitle, thumbnail, artists, album: info.album, durationSec };
    if (info.artists.length) t.artistIds = info.artistIds;
    const rating = likeStatusOf(n);
    if (rating) t.rating = rating;
    if (n.playlistItemData?.playlistSetVideoId) t.setVideoId = n.playlistItemData.playlistSetVideoId;
    const menu = parseTrackMenu(n.menu?.menuRenderer);
    if (menu) t.menu = menu;
    if (isPodcastType(musicVideoType) || pageType(titleRuns[0]?.navigationEndpoint) === EPISODE_PAGE || info.show) asEpisode(t, restRuns, info);
    else if (!isSongish) t.art = "wide";
    const label = flexRuns(n, 1);
    if (label.length > 1 && !label[0]?.navigationEndpoint) t.kind = label[0]?.text;
    return t;
  }
  const ref = refFromBrowse(n.navigationEndpoint, title, subtitle, thumbnail);
  if (ref && !ref.kind && ref.type !== "artist") ref.kind = flexRuns(n, 1)[0]?.text;
  return ref;
}

function mapMultiRow(n: R): Item | null {
  // Podcast episodes.
  const title = runsText(n.title);
  const id: string | undefined =
    n.onTap?.watchEndpoint?.videoId ?? n.playNavigationEndpoint?.watchEndpoint?.videoId ??
    n.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
  if (!title || !id) return null;
  const pr = n.playbackProgress?.musicPlaybackProgressRenderer;
  const clean = (t: R) => runsText(t).replace(/^\s*•\s*/, "").trim() || undefined;
  const played = !!clean(pr?.playedText);
  const episode: EpisodeInfo = {
    meta: runsText(n.subtitle) || undefined,
    description: runsText(n.description) || undefined,
    durationText: clean(pr?.durationText),
  };
  if (pr) episode.progress = { percent: played ? 100 : Number(pr.playbackProgressPercentage) || 0, text: played ? clean(pr.playedText) : clean(pr.playbackProgressText), played };
  const t: Track & Item = { type: "track", id, title, subtitle: runsText(n.subtitle), thumbnail: bestThumb(thumbsOf(n)), artists: [], podcast: true, episode };
  const menu = parseTrackMenu(n.menu?.menuRenderer);
  if (menu) t.menu = menu;
  if (n.playlistItemData?.playlistSetVideoId) t.setVideoId = n.playlistItemData.playlistSetVideoId;
  return t;
}

const ITEM_KEYS = ["musicTwoRowItemRenderer", "musicResponsiveListItemRenderer", "musicMultiRowListItemRenderer"];

export function mapRawItem(node: R): Item | null {
  try {
    if (node?.musicTwoRowItemRenderer) return mapTwoRow(node.musicTwoRowItemRenderer);
    if (node?.musicResponsiveListItemRenderer) return mapResponsive(node.musicResponsiveListItemRenderer);
    if (node?.musicMultiRowListItemRenderer) return mapMultiRow(node.musicMultiRowListItemRenderer);
    if (node?.continuationItemRenderer) return null;
    unknownNode(node, "item");
  } catch (e) {
    if (import.meta.env?.DEV) console.debug("[ytm] item parse failed", e);
  }
  return null;
}

export const mapRawItems = (list: R): Item[] => arr(list).map(mapRawItem).filter((i): i is Item => !!i);

/** Token from either the legacy `continuations` array or a trailing continuationItemRenderer. */
export function continuationOf(body: R, items?: R[]): Continuation | undefined {
  const legacy = arr(body?.continuations)[0];
  const t = legacy?.nextContinuationData?.continuation ?? legacy?.reloadContinuationData?.continuation;
  if (t) return t;
  const last = arr(items).at(-1)?.continuationItemRenderer;
  return last?.continuationEndpoint?.continuationCommand?.token ?? last?.button?.buttonRenderer?.command?.continuationCommand?.token;
}

function browseRef(ep: R): BrowseRef | undefined {
  const b = ep?.browseEndpoint;
  return b?.browseId ? { browseId: b.browseId, params: b.params } : undefined;
}

function mapSection(node: R, out: Shelf[], messages: string[]) {
  const key = node && typeof node === "object" ? Object.keys(node).find((k) => k.endsWith("Renderer")) : undefined;
  const n = key ? node[key] : undefined;
  switch (key) {
    case "musicCarouselShelfRenderer":
    case "musicImmersiveCarouselShelfRenderer": {
      const h = n.header?.musicCarouselShelfBasicHeaderRenderer ?? n.header?.musicImmersiveCarouselShelfHeaderRenderer ?? {};
      const items = mapRawItems(n.contents);
      if (items.length)
        out.push({
          title: runsText(h.title),
          strapline: runsText(h.strapline) || undefined,
          items,
          layout: "carousel",
          compact: arr(n.contents).some((c) => c?.musicResponsiveListItemRenderer) || undefined,
          more: browseRef(h.moreContentButton?.buttonRenderer?.navigationEndpoint ?? h.title?.runs?.[0]?.navigationEndpoint),
        });
      return;
    }
    case "musicShelfRenderer":
    case "musicPlaylistShelfRenderer": {
      const items = mapRawItems(n.contents);
      if (items.length || continuationOf(n, n.contents))
        out.push({ title: runsText(n.title), items, layout: "list", more: browseRef(n.bottomEndpoint), next: continuationOf(n, n.contents) });
      return;
    }
    case "gridRenderer": {
      const items = mapRawItems(n.items);
      if (items.length || continuationOf(n, n.items))
        out.push({ title: runsText(n.header?.gridHeaderRenderer?.title), items, layout: "grid", next: continuationOf(n, n.items) });
      return;
    }
    case "musicCardShelfRenderer": {
      const items = mapCard(n);
      if (items.length) out.push({ title: runsText(n.header?.musicCardShelfHeaderBasicRenderer?.title), items, layout: "card", actions: cardActions(n) });
      return;
    }
    case "musicDescriptionShelfRenderer":
      return; // artist bio / lyrics text: handled by dedicated parsers
    case "itemSectionRenderer":
      for (const c of arr(n.contents)) {
        const item = ITEM_KEYS.some((k) => c?.[k]) ? mapRawItem(c) : null;
        if (!item) {
          mapSection(c, out, messages);
          continue;
        }
        // New search layout: one item per ItemSection; merge consecutive loose items into one untitled list.
        const prev = out.at(-1);
        if (prev && !prev.title && prev.layout === "list" && !prev.next) prev.items.push(item);
        else out.push({ title: "", items: [item], layout: "list" });
      }
      return;
    case "messageRenderer":
    case "backgroundPromoRenderer":
    case "musicNotifierShelfRenderer": {
      const msg = [runsText(n.text ?? n.title), runsText(n.subtext ?? n.bodyText)].filter(Boolean).join(" — ");
      if (msg) messages.push(msg);
      return;
    }
    default:
      unknownNode(node, "section");
  }
}

export function parseSections(list: R): { shelves: Shelf[]; messages: string[] } {
  const shelves: Shelf[] = [];
  const messages: string[] = [];
  arr(list).forEach((s) => mapSection(s, shelves, messages));
  return { shelves, messages };
}

export function parseChips(header: R): Chip[] {
  return arr(header?.chipCloudRenderer?.chips)
    .map((c) => c?.chipCloudChipRenderer)
    .filter(Boolean)
    .map((c) => ({
      label: runsText(c.text),
      selected: !!c.isSelected,
      browse: browseRef(c.navigationEndpoint ?? c.onDeselectedCommand),
      searchParams: c.navigationEndpoint?.searchEndpoint?.params as string | undefined,
    }))
    .filter((c) => c.label);
}

function sectionLists(data: R): R[] {
  const out: R[] = [];
  // Track "related" pages put the section list directly under contents.
  if (data?.contents?.sectionListRenderer) out.push(data.contents.sectionListRenderer);
  const tabs = arr(data?.contents?.singleColumnBrowseResultsRenderer?.tabs ?? data?.contents?.tabbedSearchResultsRenderer?.tabs);
  for (const t of tabs) if (t?.tabRenderer?.content?.sectionListRenderer) out.push(t.tabRenderer.content.sectionListRenderer);
  const two = data?.contents?.twoColumnBrowseResultsRenderer;
  if (two?.secondaryContents?.sectionListRenderer) out.push(two.secondaryContents.sectionListRenderer);
  for (const t of arr(two?.tabs)) if (t?.tabRenderer?.content?.sectionListRenderer) out.push(t.tabRenderer.content.sectionListRenderer);
  return out;
}

/** Parses a /browse or /search response, or any of their continuation responses. */
export function parseBrowse(data: R): BrowsePage {
  const page: BrowsePage = { shelves: [], chips: [], messages: [], next: null };
  const add = (list: R) => {
    const p = parseSections(list);
    page.shelves.push(...p.shelves);
    page.messages.push(...p.messages);
  };
  for (const sl of sectionLists(data)) {
    add(sl.contents);
    page.chips.push(...parseChips(sl.header));
    page.next ??= continuationOf(sl, sl.contents) ?? null;
  }
  const cc = data?.continuationContents;
  if (cc?.sectionListContinuation) {
    add(cc.sectionListContinuation.contents);
    page.next = continuationOf(cc.sectionListContinuation, cc.sectionListContinuation.contents) ?? null;
  }
  for (const k of ["gridContinuation", "musicShelfContinuation", "musicPlaylistShelfContinuation"]) {
    const c = cc?.[k];
    if (!c) continue;
    const list = c.items ?? c.contents;
    page.shelves.push({ title: "", items: mapRawItems(list), layout: k === "gridContinuation" ? "grid" : "list", next: continuationOf(c, list) });
  }
  for (const a of arr(data?.onResponseReceivedActions)) {
    const list = a?.appendContinuationItemsAction?.continuationItems;
    if (!list) continue;
    const items = mapRawItems(list);
    if (items.length) page.shelves.push({ title: "", items, layout: "list", next: continuationOf(null, list) });
    else {
      add(list);
      page.next = continuationOf(null, list) ?? null;
    }
  }
  if (!page.shelves.length && !page.messages.length) {
    const alert = arr(data?.alerts).map((a) => runsText(a?.alertRenderer?.text ?? a?.alertWithButtonRenderer?.text)).filter(Boolean);
    page.messages.push(...alert);
  }
  return page;
}

/** For single-list pages (library tabs, liked songs): all items plus the list-level continuation. */
export function flattenPage(p: BrowsePage): { items: Item[]; next: Continuation | null; messages: string[] } {
  const items = p.shelves.flatMap((s) => s.items);
  // A list's own token wins; the page-level one only matters when no list came back at all.
  const next = p.shelves.length ? p.shelves.find((s) => s.next)?.next : p.next;
  return { items, next: items.length ? next ?? null : null, messages: p.messages };
}
