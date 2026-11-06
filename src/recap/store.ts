// Recaps' state for the UI: the merged data, which recaps exist and which are frozen, the yearly early unlock, and
// what the user has already seen. The rules live in the pure modules (periods, snapshot, stats); this only loads,
// decides when to freeze and saves.
import { create } from "zustand";
import { useAuth } from "../stores/auth";
import { useSettings } from "../stores/settings";
import { useToast } from "../stores/toast";
import { clockNow, onClock } from "./clock";
import { accountKey, importHistory, loadHistoryCache } from "./importer";
import { firstDay, mergePlays, type Dataset } from "./merge";
import { availability, cutoffOf, monthsToList, parsePeriodId, periodId, periodTitle, type Availability, type Period } from "./periods";
import { buildSnapshot, freezesNow, thinEarlyYear, historyFresh, keepFrozen, parseSnapshot, previewUsable, type Snapshot } from "./snapshot";
import { deleteJson, listJson, readJson, readPlays, writeJson } from "./storage";
import { mergeTakeout, parseTakeout, parseTakeoutCache } from "./takeout";

interface Meta {
  /** Year → moment it was unlocked early. */
  earlyUnlock: Record<string, number>;
  /** Recap ids the user has opened (the "new" dot is for the others). */
  seen: string[];
  /** "<recap id>:<kind>" → playlist id saved to the library. */
  playlists: Record<string, string>;
}

/**
 * Recaps belong to an account (its own YouTube history, its own saved playlists); signed out they're "local".
 * Files from before accounts were kept apart (meta.json, snapshots/<period>.json) belong to the main account.
 */
const scope = () => (useAuth.getState().status === "signedIn" ? accountKey() : "local");
const LEGACY_SCOPE = "a0";
const metaFile = (sc: string) => `meta-${sc}.json`;
const snapshotFile = (sc: string, id: string) => `snapshots/${sc}-${id}.json`;
/** A snapshot file of this scope (or, for the main account, an older unscoped one). */
const inScope = (name: string, sc: string) => name.startsWith(`snapshots/${sc}-`) || (sc === LEGACY_SCOPE && /^snapshots\/(month|year)-/.test(name));
const TAKEOUT = "takeout.json";
const EMPTY_META: Meta = { earlyUnlock: {}, seen: [], playlists: {} };

function parseMeta(v: unknown): Meta {
  const m = (v && typeof v === "object" ? v : {}) as Partial<Meta>;
  const rec = <T>(x: unknown, ok: (v: unknown) => v is T) =>
    Object.fromEntries(Object.entries(x && typeof x === "object" ? x : {}).filter(([, v]) => ok(v))) as Record<string, T>;
  return {
    earlyUnlock: rec(m.earlyUnlock, (v): v is number => Number.isFinite(v)),
    seen: Array.isArray(m.seen) ? m.seen.filter((s): s is string => typeof s === "string") : [],
    playlists: rec(m.playlists, (v): v is string => typeof v === "string"),
  };
}

export interface RecapEntry {
  period: Period;
  id: string;
  availability: Availability;
  /** Frozen on disk (shown as is, whatever the data says now). */
  frozen: Snapshot | null;
}

interface RecapState {
  loaded: boolean;
  loading: boolean;
  data: Dataset | null;
  /** The local log (and an imported Takeout history) alone: previews while the history can't be refreshed. */
  local: Dataset | null;
  /** Plays imported from Google Takeout. */
  takeout: number;
  meta: Meta;
  /** Frozen snapshots on disk, by id. */
  frozen: Record<string, Snapshot>;
  /** The newest recap that is ready and not opened yet (the menu's dot). */
  fresh: string | null;
}

export const useRecaps = create<RecapState>(() => ({ loaded: false, loading: false, data: null, local: null, takeout: 0, meta: EMPTY_META, frozen: {}, fresh: null }));

let loading: Promise<void> | null = null;
/** Bumped by forgetRecaps: a load that was running reads for an account that's no longer current. */
let loadGen = 0;

/** Loads (or reloads) everything Recaps need; `opening` = the Recaps page opened (imports history if due). */
export function loadRecaps(opening = false, fresh = false): Promise<void> {
  // `fresh`: a load already running may have read the files before a change; wait for it, then read again.
  if (loading) return fresh ? loading.catch(() => {}).then(() => loadRecaps(opening)) : loading;
  useRecaps.setState({ loading: true });
  loading = (async () => {
    try {
      if (opening) await importHistory({ opening: true }).catch(() => null);
      const sc = scope();
      const gen = loadGen;
      const [plays, cache, takeoutRaw, scopedMeta, names] = await Promise.all([readPlays().catch(() => []), loadHistoryCache(), readJson(TAKEOUT), readJson(metaFile(sc)), listJson("snapshots")]);
      const meta = scopedMeta ?? (sc === LEGACY_SCOPE ? await readJson("meta.json") : null);
      const takeout = parseTakeoutCache(takeoutRaw);
      const frozen: Record<string, Snapshot> = {};
      for (const n of names.filter((x) => inScope(x, sc))) {
        const s = parseSnapshot(await readJson(n));
        if (s?.frozen) frozen[s.id] = s;
      }
      // The account changed while reading: what was read belongs to the one before.
      if (gen !== loadGen) return;
      // An imported Takeout file is on this computer: it counts signed out and in previews too.
      const data = mergePlays(plays, useAuth.getState().status === "signedIn" ? cache.plays : [], takeout.plays);
      useRecaps.setState({ data, local: mergePlays(plays, [], takeout.plays), takeout: takeout.plays.length, meta: parseMeta(meta), frozen, loaded: true });
      useRecaps.setState({ fresh: freshRecap() });
    } finally {
      useRecaps.setState({ loading: false });
      loading = null;
    }
  })();
  return loading;
}

/** Months (newest first) and the current and previous year, with what each can show now. */
export function recapEntries(now = clockNow()): { months: RecapEntry[]; years: RecapEntry[] } {
  const { data, frozen, meta } = useRecaps.getState();
  const plays = data?.plays ?? [];
  const first = data ? firstDay(data) : null;
  const entry = (period: Period): RecapEntry => {
    const id = periodId(period);
    const f = frozen[id] ?? null;
    const early = period.kind === "year" ? meta.earlyUnlock[String(period.year)] ?? null : null;
    return { period, id, frozen: f, availability: f ? { state: "ready", cutoff: f.cutoff } : availability(period, now, plays, early) };
  };
  const year = new Date(now).getFullYear();
  const months = monthsToList(now, first).map(entry);
  const years = [year, year - 1].map((y) => entry({ kind: "year", year: y })).filter((e, i) => i === 0 || e.frozen || e.availability.state === "ready");
  return { months, years };
}

function freshRecap(): string | null {
  const { meta } = useRecaps.getState();
  const { months, years } = recapEntries();
  const ready = [...years, ...months].find((e) => e.availability.state === "ready");
  return ready && !meta.seen.includes(ready.id) ? ready.id : null;
}

async function saveMeta(patch: Partial<Meta>) {
  const meta = { ...useRecaps.getState().meta, ...patch };
  useRecaps.setState({ meta });
  await writeJson(metaFile(scope()), meta);
}

/**
 * The recap for a period: the frozen one if there is one; otherwise made now from the data and frozen when the
 * rules allow (snapshot.ts freezesNow), or returned as a preview. Null when it isn't available.
 */
export async function openRecap(period: Period): Promise<Snapshot | null> {
  if (!useRecaps.getState().loaded) await loadRecaps(true);
  const id = periodId(period);
  const state = useRecaps.getState();
  const stored = state.frozen[id] ?? null;
  const now = clockNow();
  if (!stored) {
    const early = period.kind === "year" ? state.meta.earlyUnlock[String(period.year)] ?? null : null;
    const cutoff = cutoffOf(period, now, early);
    if (cutoff === null || !state.data) return null;
    const signedIn = useAuth.getState().status === "signedIn";
    let fresh = historyFresh(onClock((await loadHistoryCache()).importedAt), now, cutoff);
    // Freezing needs the history as it is now (an early-unlocked year's cutoff is newer than any import so far).
    if (signedIn && !fresh) {
      // Only reloaded when an import really ran (offline it fails and the data is as it was).
      if (await importHistory({ force: true }).catch(() => null)) await loadRecaps(false, true);
      fresh = historyFresh(onClock((await loadHistoryCache()).importedAt), clockNow(), cutoff);
    }
    const current = useRecaps.getState();
    const frozen = freezesNow(signedIn, fresh);
    // Signed in without a fresh history (offline): a preview from this computer's data, made again next time.
    const data = frozen ? current.data! : current.local ?? current.data!;
    const made = buildSnapshot(period, data, cutoff, now, { frozen, podcasts: useSettings.getState().recap.podcasts, youtube: signedIn && frozen });
    if (!previewUsable(made)) throw new Error("couldn't refresh your YouTube Music history. Try again when you're online");
    const shown = keepFrozen(stored, made);
    if (shown.frozen) {
      await writeJson(snapshotFile(scope(), id), shown);
      useRecaps.setState({ frozen: { ...useRecaps.getState().frozen, [id]: parseSnapshot(JSON.parse(JSON.stringify(shown)))! } });
    }
    await markSeen(id);
    return shown;
  }
  await markSeen(id);
  return stored;
}

async function markSeen(id: string) {
  const { meta } = useRecaps.getState();
  if (!meta.seen.includes(id)) await saveMeta({ seen: [...meta.seen, id] });
  useRecaps.setState({ fresh: freshRecap() });
}

/** Unlocks this year's recap now (Oct 15 – Nov 30); it's frozen as of this moment. */
export async function unlockYearEarly(year: number) {
  const { meta } = useRecaps.getState();
  if (meta.earlyUnlock[String(year)]) return;
  await saveMeta({ earlyUnlock: { ...meta.earlyUnlock, [String(year)]: clockNow() } });
}

export const savedPlaylist = (recapId: string, kind: string) => useRecaps.getState().meta.playlists[`${recapId}:${kind}`] ?? null;

export async function rememberPlaylist(recapId: string, kind: string, playlistId: string | null) {
  const playlists = { ...useRecaps.getState().meta.playlists };
  if (playlistId) playlists[`${recapId}:${kind}`] = playlistId;
  else delete playlists[`${recapId}:${kind}`];
  await saveMeta({ playlists });
}

/** After "Delete all recap data": forget everything loaded. */
export function forgetRecaps() {
  loadGen++;
  useRecaps.setState({ loaded: false, data: null, local: null, takeout: 0, meta: EMPTY_META, frozen: {}, fresh: null });
}

/** Dev toolkit: drops frozen snapshots from memory (the files are deleted by the caller). */
export function forgetSnapshots() {
  useRecaps.setState({ frozen: {} });
}

/** Dev toolkit: forgets early unlocks and which recaps were seen (saved playlists stay). */
export async function resetUnlocks() {
  await saveMeta({ earlyUnlock: {}, seen: [] });
}

const ANNOUNCED_KEY = "recap-announced";
let started = false;

/** A toast once per newly ready recap (the menu's dot stays until it's opened). */
function announce() {
  const id = useRecaps.getState().fresh;
  if (!id) return;
  try {
    if (localStorage.getItem(ANNOUNCED_KEY) === id) return;
    localStorage.setItem(ANNOUNCED_KEY, id);
  } catch {
    return;
  }
  const p = parsePeriodId(id);
  if (p) useToast.getState().show(`Your ${periodTitle(p)} recap is ready: open it from your profile menu`, "info");
}

/** Looks for newly ready recaps shortly after startup and then hourly (months change at midnight). */
export function initRecaps() {
  if (started) return;
  started = true;
  // Signing in or out or switching accounts: what's loaded belongs to the account before (its history, its
  // recaps), so it's dropped and read again for the new one the next time it's needed.
  useAuth.subscribe((s, prev) => {
    if (s.accountGen !== prev.accountGen || s.status !== prev.status) forgetRecaps();
  });
  // A new recap can only appear when the month changes (or the year unlocks on Dec 1, also a month change), so the
  // hourly check reloads the data only then, not every hour.
  let checked = "";
  const check = () => {
    const d = new Date(clockNow());
    const month = `${d.getFullYear()}-${d.getMonth()}`;
    if (month === checked) return;
    void loadRecaps(false).then(() => {
      checked = month;
      announce();
    }, () => {});
  };
  setTimeout(check, 20_000);
  setInterval(check, 3_600_000);
}

export type TakeoutImport =
  | { ok: true; plays: number; added: number; from: number; to: number; youtubeOnly: number }
  | { ok: false; reason: "html" | "notHistory" | "empty" };

/**
 * Imports Google Takeout's watch-history.json (its text). Re-importing a newer export adds only what's new. Recaps
 * already frozen stay as they were.
 */
export async function importTakeout(text: string): Promise<TakeoutImport> {
  const r = parseTakeout(text);
  if (!r.ok) return r;
  if (!r.plays.length) return { ok: false, reason: "empty" };
  const before = parseTakeoutCache(await readJson(TAKEOUT));
  const next = mergeTakeout(before, r.plays, clockNow());
  await writeJson(TAKEOUT, next);
  await loadRecaps(false);
  return { ok: true, plays: next.plays.length, added: next.plays.length - before.plays.length, from: r.plays[0].at, to: r.plays.at(-1)!.at, youtubeOnly: r.youtubeOnly };
}

export async function removeTakeout() {
  await deleteJson(TAKEOUT);
  await loadRecaps(false);
}

/** One-time repair (2.5.1): yearly recaps frozen too thin by 2.5.0's early unlock are made again on next open. */
export async function repairThinYearRecaps() {
  const signedIn = useAuth.getState().status === "signedIn";
  for (const n of await listJson("snapshots")) {
    const s = parseSnapshot(await readJson(n));
    if (s && thinEarlyYear(s, signedIn)) await deleteJson(n);
  }
  forgetSnapshots();
  await loadRecaps(false).catch(() => {});
}
