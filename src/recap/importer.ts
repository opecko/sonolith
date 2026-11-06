// Background import of YouTube Music's history into Recaps' cache (ytHistory.ts): the Music and Podcasts lists, one
// request each, a pause between them, cancellable. Runs when Recaps opens (if the last import is over an hour old)
// and at most once a day otherwise. Signed out it does nothing: Recaps then use the local log alone.
import { create } from "zustand";
import { currentAccount } from "../api/client";
import { getHistory } from "../api/ytm";
import type { Shelf } from "../api/types";
import { useAuth } from "../stores/auth";
import { dayOf } from "./days";
import { readJson, writeJson } from "./storage";
import { importDue, mergeObservations, observe, parseHistoryCache, type HistoryCache } from "./ytHistory";

interface ImportState {
  running: boolean;
  /** Last import's failure, in plain words (null: fine). */
  error: string | null;
  /** The cache of the current account, once loaded. */
  cache: HistoryCache | null;
}

export const useHistoryImport = create<ImportState>(() => ({ running: false, error: null, cache: null }));

/** History differs per account (brand accounts included); the local log doesn't. */
export function accountFile(): string {
  const a = currentAccount();
  const page = (a.pageId ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  return `history/a${a.authUser}${page ? `-${page}` : ""}.json`;
}

export async function loadHistoryCache(): Promise<HistoryCache> {
  const c = parseHistoryCache(await readJson(accountFile()));
  useHistoryImport.setState({ cache: c });
  return c;
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("aborted", "AbortError"))), { once: true });
  });

let inflight: { promise: Promise<HistoryCache | null>; abort: AbortController } | null = null;

/**
 * Imports now if due (`force` skips the check). Resolves with the updated cache, or null when signed out, not due
 * (the stored cache is still loaded) or cancelled.
 */
export function importHistory(opts: { opening?: boolean; force?: boolean } = {}): Promise<HistoryCache | null> {
  // A forced import waits for one already running (which may decide it's not due) and then runs itself.
  if (inflight) return opts.force ? inflight.promise.catch(() => null).then(() => importHistory(opts)) : inflight.promise;
  const abort = new AbortController();
  const promise = run(abort.signal, opts).finally(() => {
    if (inflight?.abort === abort) inflight = null;
  });
  inflight = { promise, abort };
  return promise;
}

/** Stops a running import and waits until it's done, so nothing it read is written afterwards (Delete everything). */
export async function stopHistoryImport() {
  const running = inflight;
  running?.abort.abort();
  await running?.promise.catch(() => null);
}

async function run(signal: AbortSignal, { opening = false, force = false }): Promise<HistoryCache | null> {
  if (useAuth.getState().status !== "signedIn") return null;
  const file = accountFile();
  const cache = await loadHistoryCache();
  // Real time, never the dev toolkit's travelled clock: YouTube's "Today" is today, and a stamp from the future
  // would stop imports until that date (the data folder is shared with release builds).
  if (!force && !importDue(cache.importedAt, Date.now(), opening)) return null;
  useHistoryImport.setState({ running: true, error: null });
  try {
    const first = await getHistory();
    const shelves: Shelf[] = [...first.items];
    // The default list mixes music and episodes; the Podcasts filter reaches further back for episodes.
    const podcasts = first.chips?.find((c) => /podcast/i.test(c.label) && c.browse);
    if (podcasts?.browse) {
      await pause(800, signal);
      shelves.push(...(await getHistory(podcasts.browse)).items);
    }
    if (signal.aborted) return null;
    const now = Date.now();
    const next = mergeObservations(cache, observe(shelves, dayOf(now)), now);
    // The account may have changed meanwhile: keep each account's history in its own file. Stopped (data
    // deleted meanwhile): nothing is written back.
    if (accountFile() !== file || signal.aborted) return null;
    await writeJson(file, next);
    useHistoryImport.setState({ cache: next, running: false });
    return next;
  } catch (e) {
    if (signal.aborted) return null;
    useHistoryImport.setState({ error: "Couldn't load your YouTube Music history." });
    console.warn("history import failed:", e);
    return null;
  } finally {
    useHistoryImport.setState({ running: false });
  }
}

let started = false;

/** Daily background import: shortly after startup, then whenever a day has passed (checked hourly). */
export function initHistoryImport() {
  if (started) return;
  started = true;
  const check = () => void importHistory().catch(() => {});
  setTimeout(check, 90_000);
  setInterval(check, 3_600_000);
}
