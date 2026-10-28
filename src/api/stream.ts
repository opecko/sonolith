import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getClient } from "./client";
import { lowestVariant, pickHlsAudio } from "./hls";

export type Codec = "opus" | "aac";
export type StreamSource = "innertube" | "yt-dlp";
export interface Stream {
  url: string;
  source: StreamSource;
  codec: Codec;
  /** Served through the local Rust proxy (see src-tauri/src/proxy.rs). */
  proxied?: boolean;
  /** Original googlevideo URL and format, for diagnostics after a MediaError. */
  origin?: string;
  itag?: number;
  /** A live stream (an HLS playlist, no length, no seeking, see hls.ts). */
  live?: boolean;
}

/** Appends a line to debug/playback.log via Rust; never throws. */
export function logPlayback(line: string) {
  invoke("log_playback", { line }).catch(() => {});
}

/** What googlevideo returns for the stream's URL (status, type, first bytes); never throws. */
export function probeStream(stream: Stream): Promise<string> {
  if (!stream.origin) return Promise.resolve("no url");
  return invoke<string>("stream_probe", { url: stream.origin }).catch((e) => `probe failed: ${e}`);
}

export async function viaProxy(stream: Stream): Promise<Stream> {
  return { ...stream, url: await invoke<string>("proxy_url", { url: stream.url }), proxied: true };
}

export class UnsupportedCodecError extends Error {
  constructor() {
    super(
      /Linux/.test(navigator.userAgent)
        ? "This WebView cannot decode Opus (webm) or AAC (mp4) audio. Install gstreamer1.0-plugins-good, gstreamer1.0-plugins-bad and gstreamer1.0-libav."
        : "This system cannot decode Opus (webm) or AAC (mp4) audio.",
    );
    this.name = "UnsupportedCodecError";
  }
}

type ClientName = NonNullable<NonNullable<Parameters<Awaited<ReturnType<typeof getClient>>["getBasicInfo"]>[1]>["client"]>;

// dbg clients (2026-10-05): YTMUSIC streams are only served in full to Premium accounts. Without Premium (or signed
// out) googlevideo answers 403 to any request past the first ~1 MB, which the media element reports as "Format
// error". VISIONOS (sent without cookies, see innertube.ts) serves complete Opus and AAC streams to everyone, so it
// is the client for non-Premium accounts; YTMUSIC stays first for Premium's 256 kbps formats.
const CLIENTS: ClientName[] = ["YTMUSIC", "VISIONOS"];
/** Audio itags YouTube Music only streams to Premium accounts (Opus 256 kbps, AAC 256 kbps). */
const PREMIUM_ITAGS = new Set([774, 141]);
const MIME: Record<Codec, string> = { opus: 'audio/webm; codecs="opus"', aac: 'audio/mp4; codecs="mp4a.40.2"' };
const FORMAT_CODEC: Record<Codec, string> = { opus: "opus", aac: "mp4a" };
const CONTAINER: Record<Codec, string> = { opus: "webm", aac: "mp4" };
// WebView2 (Windows) rejects YouTube's AAC/MP4 audio ("Format error", playback-log 2026-10-05) but plays Opus/WebM;
// WebKitGTK (Linux) has always played the AAC stream through GStreamer, so it keeps AAC first.
const LINUX = /Linux/.test(navigator.userAgent);
const PREFETCH_TTL_MS = 20 * 60 * 1000;

export function supportedCodecs(canPlay: (mime: string) => string = (m) => new Audio().canPlayType(m)): Codec[] {
  return (["opus", "aac"] as Codec[]).filter((c) => canPlay(MIME[c]) !== "");
}

async function viaInnertube(videoId: string, codecs: Codec[]): Promise<Stream> {
  const yt = await getClient();
  const errors: string[] = [];
  /** A live stream's master playlist without an audio rendition: played (its cheapest variant) if no client has one. */
  let liveMaster: string | null = null;
  for (const client of CLIENTS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      // Live stations: their adaptive formats are segment URLs (the element would play a few seconds and report a
      // nonsense length), so they play the HLS audio rendition instead.
      if (info.basic_info?.is_live) {
        const hls = info.streaming_data?.hls_manifest_url;
        const master = hls ? await fetchText(hls) : null;
        const audio = master && pickHlsAudio(master);
        if (audio) return liveStream(audio);
        if (master) liveMaster ??= lowestVariant(master) ?? hls!;
        errors.push(`${client}: live, ${master ? "no audio-only rendition" : "no HLS playlist"}`);
        continue;
      }
      if (client === "YTMUSIC" && !(info.streaming_data?.adaptive_formats ?? []).some((f) => PREMIUM_ITAGS.has(f.itag))) {
        errors.push("YTMUSIC: no Premium formats, its streams would stop after ~1 MB");
        continue;
      }
      for (const codec of codecs) {
        try {
          // chooseFormat filters on container too and defaults to mp4, so Opus needs format "webm".
          const format = info.chooseFormat({ type: "audio", quality: "best", codec: FORMAT_CODEC[codec], format: CONTAINER[codec] });
          const url = await format.decipher(yt.session.player);
          if (url) return { url, source: "innertube", codec, origin: url, itag: format.itag };
        } catch (e) {
          errors.push(`${client}/${codec}: ${e}`);
        }
      }
    } catch (e) {
      errors.push(`${client}: ${e}`);
    }
  }
  if (liveMaster) return liveStream(liveMaster);
  throw new Error(`innertube: no playable format (${errors.slice(-3).join("; ")})`);
}

/**
 * A live playlist as one endless stream from the local proxy (src-tauri/src/live.rs): WebKitGTK's <audio> refuses
 * HLS itself (MediaError 4, GStreamer's HLS demuxer or not).
 */
async function liveStream(playlist: string): Promise<Stream> {
  const url = await invoke<string>("proxy_live_url", { url: playlist });
  return { url, source: "innertube", codec: "aac", origin: playlist, live: true, proxied: true };
}

/** A playlist's text (null on failure: the next client is tried). */
async function fetchText(url: string): Promise<string | null> {
  const res = await tauriFetch(url).catch(() => null);
  return res?.ok ? res.text() : null;
}

async function viaYtdlp(videoId: string, codecs: Codec[]): Promise<Stream> {
  const url = await invoke<string>("ytdlp_stream_url", { videoId, codecs });
  return { url, source: "yt-dlp", codec: codecs[0], origin: url };
}

// InnerTube (YTMUSIC, ~0.3 s) first, yt-dlp (~8 s, solves challenges via node/deno) as the fallback.
// `alternate` flips the order for retries after a MediaError.
async function resolve(videoId: string, alternate: boolean): Promise<Stream> {
  const supported = supportedCodecs();
  if (!supported.length) throw new UnsupportedCodecError();
  const codecs = LINUX ? [...supported].sort((a, b) => (a === "aac" ? -1 : b === "aac" ? 1 : 0)) : supported;
  const order = alternate ? [viaYtdlp, viaInnertube] : [viaInnertube, viaYtdlp];
  const errors: string[] = [];
  for (const attempt of order) {
    try {
      return await attempt(videoId, attempt === viaYtdlp ? supported : codecs); // yt-dlp keeps its old order
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      logPlayback(`${videoId} ${attempt === viaYtdlp ? "yt-dlp" : "innertube"} failed: ${msg}`);
    }
  }
  throw new Error(errors.join("\n"));
}

let prefetched: { id: string; at: number; promise: Promise<Stream> } | null = null;

export function prefetchStream(videoId: string) {
  if (prefetched?.id === videoId) return;
  const promise = resolve(videoId, false);
  const entry = { id: videoId, at: Date.now(), promise };
  prefetched = entry;
  promise.catch(() => {
    if (prefetched === entry) prefetched = null;
  });
}

export function getStreamUrl(videoId: string, opts: { alternate?: boolean } = {}): Promise<Stream> {
  const hit = prefetched;
  prefetched = null;
  if (!opts.alternate && hit?.id === videoId && Date.now() - hit.at < PREFETCH_TTL_MS) return hit.promise;
  return resolve(videoId, !!opts.alternate);
}

// ---------- video (podcast episodes, music videos) ----------

interface VideoFormat {
  itag: number;
  height?: number;
  fps?: number;
  mime_type: string;
}

/** Video-only stream choice: H.264 (hardware-friendly) up to 720p30, then other H.264, then VP9. */
export function pickVideoFormat<T extends VideoFormat>(formats: T[]): T | undefined {
  const score = (f: T) => {
    const avc = /avc1/.test(f.mime_type) ? 0 : 1;
    const h = f.height ?? 0;
    const fits = h <= 720 && (f.fps ?? 30) <= 30 ? 0 : 1;
    return [avc, fits, -h];
  };
  return [...formats].sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  })[0];
}

/** Resolved video URLs, by video id: switching to video and back (or remounting) doesn't resolve again. */
const videoUrls = new Map<string, { at: number; url: Promise<string> }>();
const VIDEO_URL_TTL_MS = 60 * 60 * 1000;

/**
 * Video track (no audio) of a podcast episode or music video, as a URL the webview can play; the <audio> element
 * keeps playing the sound. On Linux it always goes through the local proxy: WebKitGTK may take the raw googlevideo
 * URL at first and then fail on the Range requests a seek makes. `fresh` skips the cache (after an error).
 */
export function getVideoStreamUrl(videoId: string, fresh = false): Promise<string> {
  const hit = videoUrls.get(videoId);
  if (!fresh && hit && Date.now() - hit.at < VIDEO_URL_TTL_MS) return hit.url;
  const url = resolveVideo(videoId).then((u) => (LINUX ? invoke<string>("proxy_url", { url: u }) : u));
  videoUrls.set(videoId, { at: Date.now(), url });
  url.catch(() => videoUrls.get(videoId)?.url === url && videoUrls.delete(videoId));
  return url;
}

async function resolveVideo(videoId: string): Promise<string> {
  const yt = await getClient();
  // VISIONOS: complete streams with or without Premium (see CLIENTS); YTMUSIC as a fallback.
  const info = await yt.getBasicInfo(videoId, { client: "VISIONOS" }).catch(() => yt.getBasicInfo(videoId, { client: "YTMUSIC" }));
  const vids = (info.streaming_data?.adaptive_formats ?? []).filter((f) => f.has_video && !f.has_audio);
  const f = pickVideoFormat(vids);
  if (!f) throw new Error("There's no video for this one.");
  const url = await f.decipher(yt.session.player);
  if (!url) throw new Error("Could not resolve the video stream");
  return url;
}
