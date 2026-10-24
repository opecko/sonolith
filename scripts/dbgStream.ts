// Playback diagnostics: one line per resolution attempt, plus a yt-dlp -v run saved to debug/ytdlp.log.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Innertube } from "youtubei.js";
import { netscapeCookies } from "../src/api/cookie";
type InnerTubeClient = NonNullable<NonNullable<Parameters<Innertube["getBasicInfo"]>[1]>["client"]>;

const CLIENTS: InnerTubeClient[] = ["ANDROID", "TV", "IOS", "YTMUSIC", "WEB_EMBEDDED"];

export async function probe(url: string): Promise<string> {
  const one = async (range: string) => {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${range}` } });
      await r.body?.cancel();
      return `${range}→${r.status} ${r.headers.get("content-type") ?? ""} len=${r.headers.get("content-length")}`;
    } catch (e) {
      return `${range}→failed ${(e as Error).message}`;
    }
  };
  return `${await one("0-1023")}; ${await one("2000000-2001023")}`;
}

function which(bin: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

// Same lookup order as the app: override, then the managed copy in the app data dir, then PATH.
const MANAGED = join(process.env.HOME ?? "", ".local/share/dev.sonolith.app/bin/yt-dlp");
const defaultBin = () => process.env.YTDLP_PATH || (existsSync(MANAGED) ? MANAGED : "yt-dlp");

export async function dbgStream(yt: Innertube, videoId: string, cookie: string, ytdlp = defaultBin()) {
  const attempts: string[] = [];
  for (const client of CLIENTS) {
    const t0 = Date.now();
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      const status = info.playability_status?.status;
      if (status !== "OK") {
        attempts.push(`${client}: playability ${status} ${info.playability_status?.reason ?? ""}`.trim());
        continue;
      }
      const f = info.chooseFormat({ type: "audio", quality: "best" });
      const url = await f.decipher(yt.session.player);
      attempts.push(`${client}: ok in ${Date.now() - t0}ms itag=${f.itag} ${f.mime_type} host=${new URL(url).host} ${await probe(url)}`);
    } catch (e) {
      attempts.push(`${client}: error ${(e as Error).message.slice(0, 200)}`);
    }
  }

  const runtimes = { deno: which("deno"), node: which("node"), bun: which("bun") };
  const version = spawnSync(ytdlp, ["--version"], { encoding: "utf8" });
  const ytdlpInfo = { bin: which(ytdlp) ?? ytdlp, version: version.stdout?.trim() || version.error?.message };

  // yt-dlp -v with a temporary Netscape cookie file, deleted right after.
  const cookieFile = join(tmpdir(), `sonolith-cookies-${process.pid}.txt`);
  writeFileSync(cookieFile, netscapeCookies(cookie), { mode: 0o600 });
  const jsArgs = runtimes.deno ? [] : runtimes.node ? ["--js-runtimes", "node"] : [];
  let tail: string[] = [];
  let ok = false;
  try {
    const t0 = Date.now();
    const r = spawnSync(
      ytdlp,
      ["-v", "-g", "-f", "bestaudio", "--no-playlist", "--cookies", cookieFile, ...jsArgs, "--", `https://music.youtube.com/watch?v=${videoId}`],
      { encoding: "utf8", timeout: 120_000 },
    );
    mkdirSync("debug", { recursive: true });
    // Strip anything cookie-like before persisting the verbose log.
    const log = `${r.stderr ?? ""}\n${r.stdout ?? ""}`.replace(/(cookie[^\n]{0,20}:)[^\n]*/gi, "$1 <redacted>");
    writeFileSync("debug/ytdlp.log", log);
    tail = log.trim().split("\n").slice(-20);
    ok = r.status === 0 && /^https?:\/\//m.test(r.stdout ?? "");
    const url = (r.stdout ?? "").split("\n").find((l) => l.startsWith("http"));
    attempts.push(`yt-dlp: exit ${r.status} in ${Date.now() - t0}ms${r.error ? ` (${r.error.message})` : ""}${url ? ` ${await probe(url)}` : ""}`);
  } finally {
    if (existsSync(cookieFile)) unlinkSync(cookieFile);
  }
  return { videoId, attempts, runtimes, ytdlp: ytdlpInfo, jsArgs, ytdlpOk: ok, ytdlpTail: tail };
}
