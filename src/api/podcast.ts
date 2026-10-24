// Podcast show (MPSP… browse) and channel (user channel browse) pages.
import { bestThumb, flattenPage, pageType, parseBrowse, runsText } from "./raw";
import type { Continuation, EpisodeInfo, Shelf, Track } from "./types";

type R = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const arr = (v: unknown): R[] => (Array.isArray(v) ? v : []);

/** First value stored under `key` anywhere in `o` (headers move around between layouts). */
function find(o: R, key: string, depth = 0): R {
  if (!o || typeof o !== "object" || depth > 12) return undefined;
  if (key in o) return o[key];
  for (const v of Object.values(o)) {
    const hit = find(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const reloadToken = (ep: R): string | undefined => ep?.browseSectionListReloadEndpoint?.continuation?.reloadContinuationData?.continuation;

/** Episode filter chip; "Latest" is a dropdown with Latest / Oldest options. */
export interface ShowChip {
  label: string;
  selected: boolean;
  token?: string;
  options?: { label: string; token: string; selected: boolean }[];
}

export interface PodcastShow {
  title: string;
  thumbnail?: string;
  description?: string;
  channel?: { id: string; name: string; thumbnail?: string };
  /** Library state and the playlist id the save/unsave (like) endpoint targets. */
  saved: boolean;
  playlistId?: string;
  chips: ShowChip[];
  episodes: Track[];
  next: Continuation | null;
}

export function parseChips(data: R): ShowChip[] {
  return arr(find(data, "chipCloudRenderer")?.chips)
    .map((c) => c?.chipCloudChipRenderer)
    .filter(Boolean)
    .map((c): ShowChip => {
      const popup = c.navigationEndpoint?.openPopupAction?.popup?.menuPopupRenderer;
      const options = arr(popup?.items)
        .map((i) => i?.menuNavigationItemRenderer)
        .filter(Boolean)
        .map((i) => ({ label: runsText(i.text), token: reloadToken(i.navigationEndpoint) ?? "", selected: i.icon?.iconType === "CHECK" }))
        .filter((o) => o.label && o.token);
      const label = runsText(c.text);
      return options.length
        ? { label: options.find((o) => o.selected)?.label ?? label, selected: false, options }
        : { label, selected: !!c.isSelected, token: reloadToken(c.navigationEndpoint) };
    })
    .filter((c) => c.label && (c.token || c.options));
}

export function parseShow(data: R): PodcastShow {
  const h = find(data, "musicResponsiveHeaderRenderer") ?? {};
  const strap = arr(h.straplineTextOne?.runs)[0];
  const channelId: string | undefined = strap?.navigationEndpoint?.browseEndpoint?.browseId;
  const save = arr(h.buttons).map((b) => b?.toggleButtonRenderer).find((t) => t?.defaultServiceEndpoint?.likeEndpoint);
  const list = flattenPage(parseBrowse(data));
  return {
    title: runsText(h.title),
    thumbnail: bestThumb(h.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 300),
    description: runsText(h.description?.musicDescriptionShelfRenderer?.description) || undefined,
    channel: channelId && strap ? { id: channelId, name: runsText({ runs: [strap] }), thumbnail: bestThumb(h.straplineThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 48) } : undefined,
    saved: !!save?.isToggled,
    playlistId: save?.defaultServiceEndpoint?.likeEndpoint?.target?.playlistId,
    chips: parseChips(data),
    episodes: list.items.filter((i): i is Track => i.type === "track"),
    next: list.next,
  };
}

export interface PodcastChannel {
  id: string;
  title: string;
  avatar?: string;
  banner?: string;
  subscribed: boolean;
  subscribers?: string;
  shelves: Shelf[];
}

export function parseChannel(id: string, data: R): PodcastChannel {
  const h = data?.header?.musicVisualHeaderRenderer ?? data?.header?.musicImmersiveHeaderRenderer ?? find(data?.header, "title") ?? {};
  const sub = h.subscriptionButton?.subscribeButtonRenderer;
  return {
    id: sub?.channelId ?? id,
    title: runsText(h.title),
    avatar: bestThumb(h.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 200),
    banner: bestThumb(h.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 1200),
    subscribed: !!sub?.subscribed,
    subscribers: runsText(sub?.subscriberCountText) || undefined,
    shelves: parseBrowse(data).shelves,
  };
}

/** Is a browse endpoint a podcast show / episode page (used when routing items)? */
export const isPodcastPage = (ep: R) => /PODCAST_SHOW|NON_MUSIC_AUDIO_TRACK/.test(pageType(ep));

/** "1 hr 5 min", "30 min", "45 sec" (episode lengths as YouTube Music writes them) → seconds. */
export function parseSpokenDuration(text: string): number | undefined {
  const parts = [...text.matchAll(/(\d+)\s*(hr|hour|min|sec)/g)];
  if (!parts.length) return undefined;
  return parts.reduce((acc, [, n, unit]) => acc + Number(n) * (unit.startsWith("h") ? 3600 : unit === "min" ? 60 : 1), 0);
}

/** An episode page (MPED… browse): the episode with its show, progress and full description. */
export function parseEpisode(id: string, data: R): Track | null {
  const h = find(data, "musicResponsiveHeaderRenderer");
  const title = runsText(h?.title);
  if (!title) return null;
  const pr = h.progress?.musicPlaybackProgressRenderer;
  const clean = (t: R) => runsText(t).replace(/^\s*•\s*/, "").trim() || undefined;
  const played = !!clean(pr?.playedText);
  const meta = runsText(h.subtitle) || undefined;
  // Links in descriptions are shortened for display ("https://example.com/e..."); the endpoint has the whole URL.
  const runs = arr(find(data, "musicDescriptionShelfRenderer")?.description?.runs);
  const description = runs.map((r) => (r?.navigationEndpoint?.urlEndpoint?.url && /^https?:\/\//.test(r.text ?? "") ? r.navigationEndpoint.urlEndpoint.url : r?.text ?? "")).join("").trim();
  const episode: EpisodeInfo = {
    meta,
    published: meta?.split(" • ").pop(),
    description: description || undefined,
    durationText: clean(pr?.durationText),
  };
  if (pr) episode.progress = { percent: played ? 100 : Number(pr.playbackProgressPercentage) || 0, text: played ? clean(pr.playedText) : clean(pr.playbackProgressText), played };
  const strap = arr(h.straplineTextOne?.runs)[0];
  const showId: string | undefined = strap?.navigationEndpoint?.browseEndpoint?.browseId;
  return {
    type: "track",
    id,
    title,
    subtitle: meta ?? "",
    thumbnail: bestThumb(h.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 300),
    artists: [],
    podcast: true,
    episode,
    durationSec: episode.durationText ? parseSpokenDuration(episode.durationText) : undefined,
    show: showId ? { id: showId.replace(/^MPSP/, ""), title: runsText({ runs: [strap] }) } : undefined,
  };
}
