// Raw /next (watch-next) parsing shared by the app and scripts/dbg.ts. Never throws on unknown shapes.
import type { Exec } from "./browse";
import { parseTrackMenu } from "./menu";
import { asRating, bestThumb, pageType, parseDuration, runInfo, runsText } from "./raw";
import type { BrowseRef, QueueChip, Rating, Track } from "./types";

type R = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const arr = (v: unknown): R[] => (Array.isArray(v) ? v : []);
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export interface WatchArgs {
  videoId?: string;
  playlistId?: string;
  params?: string;
}

export interface NextResult {
  tracks: Track[];
  playlistId?: string;
  continuation?: string;
  chips: QueueChip[];
  /** Queue header, e.g. "Playing from" / "Radio · …". */
  header?: { title: string; subtitle: string };
  /** YTM's own autoplay seed (automixPreviewVideoRenderer) for finite queues. */
  automix?: WatchArgs;
  related?: BrowseRef;
  lyrics?: BrowseRef;
  /** The signed-in user's thumbs rating of the requested video. */
  rating?: Rating;
}

export function mapPanelVideo(n: R): Track | null {
  const id: string | undefined = n?.videoId ?? n?.navigationEndpoint?.watchEndpoint?.videoId;
  if (!id || !VIDEO_ID.test(id)) return null;
  const runs = arr(n.longBylineText?.runs ?? n.shortBylineText?.runs);
  const info = runInfo(runs);
  const artists = info.artists.length ? info.artists : [runsText(n.shortBylineText)].filter(Boolean);
  const explicit = arr(n.badges).some((b) => /EXPLICIT/.test(b?.musicInlineBadgeRenderer?.icon?.iconType ?? ""));
  const t: Track = {
    type: "track",
    id,
    title: runsText(n.title),
    subtitle: runsText({ runs }) || artists.join(", "),
    thumbnail: bestThumb(n.thumbnail?.thumbnails, 120),
    artists,
    album: info.album,
    durationSec: parseDuration(runsText(n.lengthText)),
  };
  if (info.artists.length) t.artistIds = info.artistIds;
  if (explicit) t.explicit = true;
  const mvt = n.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  if ((typeof mvt === "string" && mvt.includes("PODCAST")) || info.show) {
    // An episode: its byline is the show, not artists.
    t.podcast = true;
    t.artists = [];
    delete t.artistIds;
    if (info.show) t.show = info.show;
  }
  const menu = parseTrackMenu(n.menu?.menuRenderer);
  if (menu) t.menu = menu;
  return t;
}

/** playlistPanel contents: plain videos and wrapper renderers (primaryRenderer); automix previews skipped. */
export function mapPanelItems(list: R): Track[] {
  const out: Track[] = [];
  for (const c of arr(list)) {
    const v = c?.playlistPanelVideoRenderer ?? c?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    const t = v ? mapPanelVideo(v) : null;
    if (t) out.push(t);
  }
  return out;
}

export function mapChips(queue: R): QueueChip[] {
  return arr(queue?.subHeaderChipCloud?.chipCloudRenderer?.chips)
    .map((c, i): QueueChip | null => {
      const r = c?.chipCloudChipRenderer;
      const label = runsText(r?.text);
      if (!label) return null;
      const ep = r?.navigationEndpoint;
      const w = ep?.queueUpdateCommand?.fetchContentsCommand?.watchEndpoint ?? ep?.watchEndpoint ?? ep?.watchPlaylistEndpoint;
      const endpoint = w?.playlistId || w?.videoId ? { videoId: w.videoId, playlistId: w.playlistId, params: w.params } : null;
      return { id: `${i}:${label}`, label, endpoint, selected: !!r?.isSelected };
    })
    .filter((c): c is QueueChip => !!c);
}

function panelContinuation(panel: R): string | undefined {
  const c = arr(panel?.continuations)[0];
  return c?.nextRadioContinuationData?.continuation ?? c?.nextContinuationData?.continuation;
}

function tabRef(tab: R): BrowseRef | undefined {
  const b = tab?.tabRenderer?.endpoint?.browseEndpoint;
  return b?.browseId && !tab.tabRenderer.unselectable ? { browseId: b.browseId, params: b.params } : undefined;
}

export function parseNext(data: R): NextResult {
  const out: NextResult = { tracks: [], chips: [] };
  const cont = data?.continuationContents?.playlistPanelContinuation;
  if (cont) {
    out.tracks = mapPanelItems(cont.contents);
    out.continuation = panelContinuation(cont);
    out.playlistId = cont.playlistId;
    return out;
  }
  const tabs = arr(data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs);
  const queue = tabs[0]?.tabRenderer?.content?.musicQueueRenderer;
  const panel = queue?.content?.playlistPanelRenderer;
  out.tracks = mapPanelItems(panel?.contents);
  out.playlistId = panel?.playlistId;
  out.continuation = panelContinuation(panel);
  out.chips = mapChips(queue);
  const h = queue?.header?.musicQueueHeaderRenderer;
  if (h) out.header = { title: runsText(h.title), subtitle: runsText(h.subtitle) };
  for (const c of arr(panel?.contents)) {
    const w = c?.automixPreviewVideoRenderer?.content?.automixPlaylistVideoRenderer?.navigationEndpoint?.watchPlaylistEndpoint;
    if (w?.playlistId) out.automix = { playlistId: w.playlistId, params: w.params };
  }
  const overlay = data?.playerOverlays?.playerOverlayRenderer?.actions;
  for (const a of arr(overlay)) {
    const r = asRating(a?.likeButtonRenderer?.likeStatus);
    if (r) out.rating = r;
  }
  for (const t of tabs.slice(1)) {
    const pt = pageType(t?.tabRenderer?.endpoint);
    if (pt === "MUSIC_PAGE_TYPE_TRACK_LYRICS") out.lyrics = tabRef(t);
    else if (pt === "MUSIC_PAGE_TYPE_TRACK_RELATED") out.related = tabRef(t);
  }
  return out;
}

export async function fetchNext(exec: Exec, args: WatchArgs | { continuation: string }): Promise<NextResult> {
  return parseNext(await exec("/next", { ...args, isAudioOnly: true }));
}

/** Tracks of a chip, minus the current one (chip queues start with it). */
export async function fetchChipTracks(exec: Exec, chip: QueueChip, currentId: string): Promise<{ tracks: Track[]; continuation?: string; playlistId?: string }> {
  if (!chip.endpoint) throw new Error(`Chip "${chip.label}" has no endpoint`);
  const r = await fetchNext(exec, chip.endpoint);
  return { tracks: r.tracks.filter((t) => t.id !== currentId), continuation: r.continuation, playlistId: r.playlistId };
}

// ---------- radio ----------

export type RadioSource =
  | { type: "song"; id: string }
  | { type: "playlist"; id: string }
  | { type: "mix"; id: string; params?: string }
  | { type: "album"; id: string }
  | { type: "artist"; id: string };

export interface RadioQueue {
  tracks: Track[];
  playlistId?: string;
  params?: string;
  continuation?: string;
  title?: string;
  /** How the endpoint was obtained (for dbg / logs). */
  via: "page" | "fallback";
}

// Content lists hold per-track menus with their own song radios; only header/menu areas are searched.
const SKIP = /^(musicShelfRenderer|musicPlaylistShelfRenderer|musicCarouselShelfRenderer|gridRenderer|contents|secondaryContents|continuationContents)$/;

/** First RD… radio endpoint outside of track lists (page header buttons / header menu). */
export function findRadioEndpoint(data: R): WatchArgs | null {
  let hit: WatchArgs | null = null;
  const visit = (o: R, depth: number) => {
    if (hit || !o || typeof o !== "object" || depth > 30) return;
    if (Array.isArray(o)) return o.forEach((x) => visit(x, depth + 1));
    for (const k of ["watchPlaylistEndpoint", "watchEndpoint"]) {
      const w = o[k];
      if (typeof w?.playlistId === "string" && w.playlistId.startsWith("RD")) {
        hit = { playlistId: w.playlistId, params: w.params, videoId: w.videoId };
        return;
      }
    }
    for (const [k, v] of Object.entries(o)) if (!SKIP.test(k)) visit(v, depth + 1);
  };
  // Headers first (artist: data.header; playlist/album: first section of the tab content), then the rest.
  visit(data?.header, 0);
  const tab = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0];
  if (!hit) visit(tab, 0);
  if (!hit) visit(data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0], 0);
  return hit;
}

export async function radioEndpoint(exec: Exec, src: RadioSource): Promise<{ args: WatchArgs; via: RadioQueue["via"] }> {
  switch (src.type) {
    case "song":
      // Same endpoint the song menu's "Start radio" item carries.
      return { args: { videoId: src.id, playlistId: `RDAMVM${src.id}`, params: "wAEB" }, via: "fallback" };
    case "mix":
      return { args: { playlistId: src.id, ...(src.params ? { params: src.params } : {}) }, via: "fallback" };
    case "playlist": {
      const ep = findRadioEndpoint(await exec("/browse", { browseId: src.id.startsWith("VL") ? src.id : `VL${src.id}` }).catch(() => null));
      return ep ? { args: ep, via: "page" } : { args: { playlistId: `RDAMPL${src.id.replace(/^VL/, "")}` }, via: "fallback" };
    }
    case "album": {
      if (src.id.startsWith("OLAK")) return { args: { playlistId: `RDAMPL${src.id}` }, via: "fallback" };
      const page = await exec("/browse", { browseId: src.id });
      const ep = findRadioEndpoint(page);
      if (ep) return { args: ep, via: "page" };
      const olak = JSON.stringify(page ?? "").match(/OLAK5uy_[A-Za-z0-9_-]+/)?.[0];
      if (!olak) throw new Error("Album has no radio endpoint and no audio playlist id");
      return { args: { playlistId: `RDAMPL${olak}` }, via: "fallback" };
    }
    case "artist": {
      const ep = findRadioEndpoint(await exec("/browse", { browseId: src.id }));
      if (!ep) throw new Error("Artist page has no radio button");
      return { args: ep, via: "page" };
    }
  }
}

export async function startRadio(exec: Exec, src: RadioSource): Promise<RadioQueue> {
  const { args, via } = await radioEndpoint(exec, src);
  const r = await fetchNext(exec, args);
  if (!r.tracks.length) throw new Error(`Radio returned no tracks (${args.playlistId ?? args.videoId})`);
  return { tracks: r.tracks, playlistId: r.playlistId ?? args.playlistId, params: args.params, continuation: r.continuation, title: r.header?.subtitle, via };
}

// ---------- Now Playing side tabs ----------

export interface Lyrics {
  text: string;
  source?: string;
}

/** Lyrics browse page (MPLYt…): musicDescriptionShelfRenderer text + footer; null when absent. */
export function parseLyrics(data: R): Lyrics | null {
  const shelf = arr(data?.contents?.sectionListRenderer?.contents).find((c) => c?.musicDescriptionShelfRenderer)?.musicDescriptionShelfRenderer;
  const text = runsText(shelf?.description);
  return text ? { text, source: runsText(shelf?.footer) || undefined } : null;
}
