/**
 * Live streams (YouTube Music's live stations) come only as HLS: a master playlist whose variants carry video, plus
 * audio-only renditions (`#EXT-X-MEDIA:TYPE=AUDIO`, itag 233 HE-AAC and 234 AAC 128 kbps as of 2026-10). The
 * <audio> element plays the audio rendition's own playlist, so no video is downloaded.
 */

/** `KEY=value,KEY="quoted, value"` → map. */
function attrs(line: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.set(m[1], m[2].replace(/^"|"$/g, ""));
  return out;
}

/**
 * The best audio-only rendition's playlist URL in a master playlist: the audio group the highest-bandwidth
 * variant uses (the best audio YouTube pairs with its best picture), else the last audio rendition listed. Null
 * when there is none (the caller can fall back to the master playlist itself).
 */
export function pickHlsAudio(master: string): string | null {
  const lines = master.split(/\r?\n/);
  const audio = new Map<string, string>(); // group id → URI
  let bestGroup: string | undefined;
  let bestBandwidth = -1;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const a = attrs(line.slice(13));
      if (a.get("TYPE") === "AUDIO" && a.get("URI")) audio.set(a.get("GROUP-ID") ?? "", a.get("URI")!);
    } else if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const a = attrs(line.slice(18));
      const bw = Number(a.get("BANDWIDTH") ?? 0);
      if (a.get("AUDIO") && bw > bestBandwidth) {
        bestBandwidth = bw;
        bestGroup = a.get("AUDIO");
      }
    }
  }
  if (bestGroup !== undefined && audio.has(bestGroup)) return audio.get(bestGroup)!;
  return [...audio.values()].at(-1) ?? null;
}

/**
 * The lowest-bandwidth variant's playlist URL (null: none): for a master playlist without audio renditions (the
 * YTMUSIC client's has only muxed variants), the cheapest picture to download along with the sound.
 */
export function lowestVariant(master: string): string | null {
  const lines = master.split(/\r?\n/);
  let best: string | null = null;
  let bestBandwidth = Infinity;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const bw = Number(attrs(lines[i].slice(18)).get("BANDWIDTH") ?? Infinity);
    const uri = lines[i + 1]?.trim();
    if (uri && !uri.startsWith("#") && bw < bestBandwidth) {
      bestBandwidth = bw;
      best = uri;
    }
  }
  return best;
}

/**
 * The picture for a live stream's video mode: the best variant up to `maxHeight` lines (720p decodes fine in
 * software), else the smallest. Null when the playlist lists no variants.
 */
export function pickHlsVideo(master: string, maxHeight = 720): string | null {
  const lines = master.split(/\r?\n/);
  const variants: { uri: string; height: number; bandwidth: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const a = attrs(lines[i].slice(18));
    const uri = lines[i + 1]?.trim();
    if (!uri || uri.startsWith("#")) continue;
    variants.push({ uri, height: Number(a.get("RESOLUTION")?.split("x")[1] ?? 0), bandwidth: Number(a.get("BANDWIDTH") ?? 0) });
  }
  const fits = variants.filter((v) => v.height <= maxHeight).sort((x, y) => y.bandwidth - x.bandwidth);
  return fits[0]?.uri ?? [...variants].sort((x, y) => x.height - y.height)[0]?.uri ?? null;
}
