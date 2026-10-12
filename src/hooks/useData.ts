import { useCallback, useEffect, useRef, useState } from "react";
import type { Page } from "../api/types";

const cache = new Map<string, unknown>();
/** Requests started ahead of time (hover prefetch); useAsync joins them instead of fetching again. */
const pending = new Map<string, Promise<unknown>>();
export const clearDataCache = () => {
  cache.clear();
  pending.clear();
};

/** Views showing a key, so `invalidate` can make them refetch. */
const watchers = new Map<string, Set<() => void>>();
/** Drops a cached page after the data changed (e.g. a song added to a playlist); an open view reloads it. */
export function invalidate(key: string) {
  cache.delete(key);
  watchers.get(key)?.forEach((fn) => fn());
}

function fetchShared<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const p = (pending.get(key) as Promise<T> | undefined) ?? fn();
  if (!pending.has(key)) {
    pending.set(key, p);
    p.then((d) => cache.set(key, d), () => {}).finally(() => pending.delete(key));
  }
  return p;
}

/** Warms the cache for a view the user is likely to open next (e.g. on card hover). */
export function prefetch<T>(key: string, fn: () => Promise<T>) {
  if (!cache.has(key) && !pending.has(key)) void fetchShared(key, fn).catch(() => {});
}

const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

export function useAsync<T>(key: string, fn: () => Promise<T>) {
  const [state, setState] = useState<{ key?: string; data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const hit = cache.get(key) as T | undefined;
    if (hit !== undefined) {
      setState({ key, data: hit, loading: false });
      return;
    }
    let live = true;
    // A refetch of the same key keeps showing the old data until the new one arrives.
    setState((s) => (s.key === key && s.data !== undefined ? { ...s, loading: true } : { key, loading: true }));
    fetchShared(key, fnRef.current).then(
      (data) => {
        if (!live) return;
        setState({ key, data, loading: false });
      },
      (e) => live && setState({ key, error: toError(e), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => {
    cache.delete(key);
    setNonce((n) => n + 1);
  }, [key]);
  useEffect(() => {
    // Refetch in place (the old data stays on screen until the new one arrives).
    const fn = () => setNonce((n) => n + 1);
    const set = watchers.get(key) ?? new Set();
    set.add(fn);
    watchers.set(key, set);
    return () => {
      set.delete(fn);
      if (!set.size) watchers.delete(key);
    };
  }, [key]);
  return { ...state, reload };
}

interface PagedSnapshot<T> {
  items: T[];
  next: Page<T>["loadMore"];
  chips?: Page<T>["chips"];
}

export function usePaged<T>(key: string | null, first: () => Promise<Page<T>>) {
  const [snap, setSnap] = useState<PagedSnapshot<T> | null>(null);
  const [error, setError] = useState<Error>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [nonce, setNonce] = useState(0);
  const firstRef = useRef(first);
  firstRef.current = first;
  const busy = useRef(false);
  const shownKey = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const fn = () => setNonce((n) => n + 1);
    const set = watchers.get(key) ?? new Set();
    set.add(fn);
    watchers.set(key, set);
    return () => {
      set.delete(fn);
      if (!set.size) watchers.delete(key);
    };
  }, [key]);

  useEffect(() => {
    setError(undefined);
    if (key === null) return setSnap(null);
    const hit = cache.get(key) as PagedSnapshot<T> | undefined;
    if (hit) return setSnap(hit);
    let live = true;
    // A refetch of the same key (invalidate) keeps the old items on screen until the new ones arrive.
    if (shownKey.current !== key) setSnap(null);
    shownKey.current = key;
    firstRef.current().then(
      (p) => {
        if (!live) return;
        const s = { items: p.items, next: p.loadMore, chips: p.chips };
        cache.set(key, s);
        setSnap(s);
      },
      (e) => live && setError(toError(e)),
    );
    return () => {
      live = false;
    };
  }, [key, nonce]);

  const loadMore = useCallback(async () => {
    if (!snap?.next || busy.current || key === null) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const p = await snap.next();
      const s = { ...snap, items: [...snap.items, ...p.items], next: p.loadMore };
      cache.set(key, s);
      setSnap(s);
    } catch (e) {
      setError(toError(e));
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [snap, key]);

  const reload = useCallback(() => {
    if (key !== null) cache.delete(key);
    setNonce((n) => n + 1);
  }, [key]);

  return {
    items: snap?.items,
    chips: snap?.chips,
    hasMore: !!snap?.next,
    loading: !snap && !error && key !== null,
    loadingMore,
    error,
    loadMore,
    reload,
  };
}
