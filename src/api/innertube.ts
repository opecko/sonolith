// Runtime-agnostic Innertube setup (no Tauri imports) so scripts/dbg.ts can share it with the app.
import { Innertube, Platform } from "youtubei.js";
import { parseCookie, sapisidHash } from "./cookie";

export const ORIGIN = "https://music.youtube.com";
export const LANG = "en";
export const LOCATION = "CZ";

const isYouTubeApi = (url: string) => /^https:\/\/(music|www)\.youtube\.com\/youtubei\//.test(url);
/** Playback stats pings (watch history); they only count when sent with the account cookie. */
const isStatsPing = (url: string) => /^https:\/\/(music|www|s)\.youtube\.com\/api\/stats\//.test(url);

export interface YtFetchOptions {
  cookie: () => string | null;
  authUser?: () => number;
  onResponse?: (res: Response) => void;
}

/**
 * Wraps a fetch so every InnerTube call carries cookie, X-Goog-AuthUser and a SAPISIDHASH whose origin matches the
 * request host (youtubei.js always hashes for www.youtube.com).
 */
export function makeYtFetch(base: typeof fetch, opts: YtFetchOptions): typeof fetch {
  return async (input, init) => {
    let url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const cookie = opts.cookie();
    const api = isYouTubeApi(url);
    // youtubei.js always targets www.youtube.com; YT Music web calls go to music.youtube.com.
    if (api && typeof init?.body === "string" && init.body.includes('"clientName":"WEB_REMIX"'))
      url = url.replace("://www.youtube.com/", "://music.youtube.com/");
    // Mobile clients reject cookie/SAPISID auth with 400 INVALID_ARGUMENT; send them anonymously.
    const mobile = api && typeof init?.body === "string" && /"clientName":"(ANDROID|IOS|VISIONOS)[A-Z_]*"/.test(init.body);
    if (mobile) {
      for (const h of ["Cookie", "Authorization", "X-Goog-AuthUser"]) headers.delete(h);
      // Without an explicit Origin the Tauri HTTP plugin sends the app's own (http://tauri.localhost on Windows,
      // tauri://localhost on Linux), and /player answers mobile clients with 403 (dbg origin, 2026-10-05).
      headers.set("Origin", "https://www.youtube.com");
    }
    if ((api || isStatsPing(url)) && cookie && !mobile) {
      const origin = new URL(url).origin; // must match Host or Google answers 400
      headers.set("Cookie", cookie);
      headers.set("Origin", origin);
      headers.set("X-Origin", origin);
      headers.set("Referer", `${origin}/`);
      headers.set("X-Goog-AuthUser", String(opts.authUser?.() ?? 0));
      const jar = parseCookie(cookie);
      const sapisid = jar.SAPISID ?? jar["__Secure-3PAPISID"];
      if (sapisid) headers.set("Authorization", await sapisidHash(sapisid, origin));
    }
    const method = init?.method ?? (input instanceof Request ? input.method : undefined);
    const res = await base(api ? url : (input as RequestInfo), { ...init, method, headers });
    opts.onResponse?.(res);
    return res;
  };
}

/**
 * youtubei.js needs a JS evaluator to decipher stream URLs (n / signature). The extracted player script ends with
 * `return process(...)`, so running it as a function body is enough. Used by the app and scripts/dbg.ts.
 */
Platform.shim.eval = (data) => new Function(data.output)();

/** Without a cookie the client is anonymous (signed out): browsing, search and playback still work. */
export function createInnertube(fetchFn: typeof fetch, cookie?: string, accountIndex = 0) {
  return Innertube.create({
    cookie,
    fetch: fetchFn,
    lang: LANG,
    location: LOCATION,
    account_index: accountIndex,
  });
}

/** Reads the server's own `logged_in` tracking param from any raw InnerTube response. */
export function loggedInFlag(data: unknown): boolean | null {
  const params = (data as { responseContext?: { serviceTrackingParams?: { params?: { key: string; value: string }[] }[] } })
    ?.responseContext?.serviceTrackingParams;
  for (const s of params ?? []) for (const p of s.params ?? []) if (p.key === "logged_in") return p.value === "1";
  return null;
}
