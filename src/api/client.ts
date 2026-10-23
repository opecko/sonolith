import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import type { Innertube } from "youtubei.js";
import { createInnertube, makeYtFetch } from "./innertube";

let cached: Promise<Innertube> | null = null;
let cookieValue: string | null = null;
let authUser = 0;
let expiredHandler: (() => void) | null = null;
export const setAuthExpiredHandler = (h: () => void) => (expiredHandler = h);
/** Account index for multi-account / brand-account cookies (X-Goog-AuthUser). */
export const setAuthUser = (n: number) => {
  authUser = n;
  cached = null;
};

/** fetch that adds the account cookie + SAPISIDHASH for InnerTube and stats-ping URLs. */
export const ytFetch = makeYtFetch(tauriFetch as typeof fetch, {
  cookie: () => cookieValue,
  authUser: () => authUser,
  onResponse: (res) => {
    // Signed out, a 401 is just an account-only request: nothing has expired.
    if (res.status === 401 && cookieValue) {
      cached = null;
      expiredHandler?.();
    }
  },
});

export class AuthError extends Error {
  constructor(message = "Not signed in or session expired") {
    super(message);
    this.name = "AuthError";
  }
}

export function getCookie(): Promise<string | null> {
  return invoke<string | null>("auth_get_cookie");
}

/** The InnerTube client: signed in with the stored cookie, or anonymous without one. */
export function getClient(): Promise<Innertube> {
  cached ??= (async () => {
    const cookie = await getCookie();
    cookieValue = cookie;
    return createInnertube(ytFetch, cookie ?? undefined, authUser);
  })();
  cached.catch(() => (cached = null));
  return cached;
}

/** For requests that act on the account (library, likes, playlists, history): signed out, they fail with AuthError. */
export async function getAccountClient(): Promise<Innertube> {
  const client = await getClient();
  if (!cookieValue) throw new AuthError("Sign in to YouTube Music to use your library, likes and playlists.");
  return client;
}

export function resetClient() {
  cached = null;
}
