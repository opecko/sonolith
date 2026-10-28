// The account switcher: the Google accounts in the signed-in cookie and their channels (brand accounts), and which
// one the app acts as. A choice is the cookie's session index (X-Goog-AuthUser) plus, for a brand account, its page
// id (InnerTube `context.user.onBehalfOfUser`). Parsers never throw on unknown shapes.
import { bestThumb, runsText } from "./raw";

type R = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const arr = (v: unknown): R[] => (Array.isArray(v) ? v : []);

export interface AccountChoice {
  authUser: number;
  pageId?: string;
}

export const DEFAULT_ACCOUNT: AccountChoice = { authUser: 0 };

export interface SwitcherAccount extends AccountChoice {
  name: string;
  handle?: string;
  photo?: string;
  /** e.g. "8 subscribers" */
  byline?: string;
  /** What YouTube marks as active in the cookie session; the app's own choice is `sameAccount` against the stored one. */
  selected: boolean;
}

/** One Google account (signed in to the cookie) with its channels. */
export interface AccountGroup {
  /** The Google account's name and/or e-mail address, as YouTube labels the group. */
  title: string;
  subtitle?: string;
  accounts: SwitcherAccount[];
}

export const sameAccount = (a: AccountChoice, b: AccountChoice) => a.authUser === b.authUser && (a.pageId ?? "") === (b.pageId ?? "");

/** Reads `authuser` and `pageid` from the item's sign-in URL, with the page id token as a fallback. */
function choiceOf(endpoint: R): AccountChoice | null {
  const tokens = arr(endpoint?.selectActiveIdentityEndpoint?.supportedTokens);
  const signinUrl: unknown = tokens.find((t) => t?.accountSigninToken)?.accountSigninToken?.signinUrl;
  if (typeof signinUrl !== "string") return null;
  const q = new URL(signinUrl, "https://music.youtube.com").searchParams;
  const authUser = Number(q.get("authuser") ?? "0");
  if (!Number.isInteger(authUser) || authUser < 0) return null;
  const pageId = q.get("pageid") ?? tokens.find((t) => t?.pageIdToken)?.pageIdToken?.pageId;
  return typeof pageId === "string" && /^\d+$/.test(pageId) ? { authUser, pageId } : { authUser };
}

function parseItem(n: R): SwitcherAccount | null {
  const item = n?.accountItem;
  if (!item || item.isDisabled) return null;
  const choice = choiceOf(item.serviceEndpoint);
  const name = runsText(item.accountName);
  if (!choice || !name) return null;
  return {
    ...choice,
    name,
    handle: runsText(item.channelHandle) || undefined,
    // Channel photos come at 36–48 px; ask for a sharper one (the =sN size suffix).
    photo: bestThumb(item.accountPhoto?.thumbnails, 48)?.replace(/=s\d+-/, "=s96-"),
    byline: runsText(item.accountByline) || undefined,
    selected: item.isSelected === true,
  };
}

function parseGroup(n: R): AccountGroup | null {
  const section = n?.accountSectionListRenderer;
  if (!section) return null;
  const accounts = arr(section.contents)
    .flatMap((c) => arr(c?.accountItemSectionRenderer?.contents))
    .map(parseItem)
    .filter((a): a is SwitcherAccount => !!a);
  if (!accounts.length) return null;
  // The active account's group has a Google account header (name + e-mail); the others a header with the e-mail.
  const google = section.header?.googleAccountHeaderRenderer;
  const titled = arr(section.contents).map((c) => runsText(c?.accountItemSectionRenderer?.header?.accountItemSectionHeaderRenderer?.title)).find(Boolean);
  const title = runsText(google?.name) || titled || runsText(google?.email);
  const email = runsText(google?.email);
  return { title, subtitle: email && email !== title ? email : undefined, accounts };
}

/**
 * Parses the `getAccountSwitcherEndpoint` response (JSON behind the `)]}'` guard, the menu under `data`). Returns
 * the groups in YouTube's order, or [] for anything unexpected.
 */
export function parseAccountSwitcher(text: string): AccountGroup[] {
  let data: R;
  try {
    data = JSON.parse(text.replace(/^\)\]\}'\s*/, ""));
  } catch {
    return [];
  }
  const root = data?.data ?? data;
  const menu = arr(root?.actions).map((a) => a?.getMultiPageMenuAction?.menu?.multiPageMenuRenderer).find(Boolean);
  return arr(menu?.sections).map(parseGroup).filter((g): g is AccountGroup => !!g);
}

/** Normalizes a stored choice; anything malformed is the default account. */
export function normalizeChoice(v: unknown): AccountChoice {
  const o = v as { authUser?: unknown; pageId?: unknown } | null;
  const authUser = typeof o?.authUser === "number" && Number.isInteger(o.authUser) && o.authUser >= 0 && o.authUser < 100 ? o.authUser : 0;
  const pageId = typeof o?.pageId === "string" && /^\d+$/.test(o.pageId) ? o.pageId : undefined;
  return pageId ? { authUser, pageId } : { authUser };
}
