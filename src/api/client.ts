import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { invoke } from "@tauri-apps/api/core";
import type { Innertube } from "youtubei.js";
import { DEFAULT_ACCOUNT, normalizeChoice, parseAccountSwitcher, type AccountChoice, type AccountGroup } from "./accounts";
import { ACCOUNT_SWITCHER_URL, createInnertube, makeYtFetch } from "./innertube";

let cached: Promise<Innertube> | null = null;
let cookieValue: string | null = null;
let expiredHandler: (() => void) | null = null;
export const setAuthExpiredHandler = (h: () => void) => (expiredHandler = h);

const ACCOUNT_KEY = "account";
function storedAccount(): AccountChoice {
  try {
    return normalizeChoice(JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? "null"));
  } catch {
    return DEFAULT_ACCOUNT;
  }
}
/** Which account of the cookie the app acts as (switcher): X-Goog-AuthUser and, for a brand account, its page id. */
let account: AccountChoice = storedAccount();
export const currentAccount = () => account;
/** Switches the account every following request acts as; the caller drops cached data. */
export function setAccount(choice: AccountChoice) {
  account = normalizeChoice(choice);
  cached = null;
  try {
    if (account.authUser || account.pageId) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* storage unavailable: the choice lasts until restart */
  }
}

/** fetch that adds the account cookie + SAPISIDHASH for InnerTube and stats-ping URLs. */
export const ytFetch = makeYtFetch(tauriFetch as typeof fetch, {
  cookie: () => cookieValue,
  authUser: () => account.authUser,
  pageId: () => account.pageId,
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
    return cookie ? createInnertube(ytFetch, cookie, account.authUser, account.pageId) : createInnertube(ytFetch);
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

/** The accounts and channels the signed-in cookie can switch between, grouped per Google account. */
export async function getAccountSwitcher(): Promise<AccountGroup[]> {
  await getAccountClient();
  const res = await ytFetch(ACCOUNT_SWITCHER_URL, { method: "GET" });
  if (!res.ok) throw new Error(`Account list failed (${res.status})`);
  return parseAccountSwitcher(await res.text());
}
