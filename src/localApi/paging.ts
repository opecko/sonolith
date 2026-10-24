// Cursors over YouTube's own page sizes: a client asks for `limit` items, we follow the source's continuations and
// keep what is left over for the next cursor (api/SPEC.md 13.6).
import type { Page } from "../api/types";
import { ApiError } from "./errors";

const TTL_MS = 30 * 60_000;
const MAX_CURSORS = 200;
/** Source pages fetched at most to fill one answer; a short page is fine (the client follows nextCursor). */
const MAX_FETCHES = 5;

interface State<R> {
  key: string;
  buffer: R[];
  more: (() => Promise<Page<unknown>>) | null;
  at: number;
}

const cursors = new Map<string, State<unknown>>();
let counter = 0;

function store<R>(s: State<R>): string {
  const id = `c${(++counter).toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  cursors.set(id, s as State<unknown>);
  if (cursors.size > MAX_CURSORS) cursors.delete(cursors.keys().next().value!);
  return id;
}

/**
 * One page of `limit` mapped items. `key` names the list (method + its params), so a cursor only continues the
 * list it came from; `map` drops items the API has no type for (null).
 */
export async function page<T, R>(
  key: string,
  cursor: string | undefined,
  limit: number | undefined,
  first: () => Promise<Page<T>>,
  map: (item: T) => R | null,
  now = Date.now(),
): Promise<{ items: R[]; nextCursor: string | null }> {
  const n = limit ?? 50;
  let state: State<R>;
  if (cursor !== undefined) {
    const s = cursors.get(cursor) as State<R> | undefined;
    cursors.delete(cursor);
    if (!s || s.key !== key || now - s.at > TTL_MS) throw new ApiError("InvalidParams", "cursorExpired", { path: "/cursor" });
    state = s;
  } else {
    state = { key, buffer: [], more: first as () => Promise<Page<unknown>>, at: now };
  }
  for (let i = 0; state.buffer.length < n && state.more && i < MAX_FETCHES; i++) {
    const p = (await state.more()) as Page<T>;
    state.buffer.push(...p.items.map(map).filter((x): x is R => x !== null));
    state.more = p.loadMore as (() => Promise<Page<unknown>>) | null;
  }
  const items = state.buffer.slice(0, n);
  const rest = state.buffer.slice(n);
  const nextCursor = rest.length || state.more ? store({ key, buffer: rest, more: state.more, at: now }) : null;
  return { items, nextCursor };
}

/** Pages over a list that is already in memory (the queue), valid while `revision` stays the same. */
export function slice<T>(list: T[], from: number, limit: number | undefined, revision: number): { items: T[]; nextCursor: string | null } {
  const end = Math.min(list.length, from + (limit ?? 50));
  return { items: list.slice(from, end), nextCursor: end < list.length ? `q${revision}.${end}` : null };
}

/** Where a `slice` cursor continues, or cursorExpired when the list changed since. */
export function sliceCursor(cursor: string, revision: number): number {
  const m = /^q(\d+)\.(\d+)$/.exec(cursor);
  if (!m || Number(m[1]) !== revision) throw new ApiError("InvalidParams", "cursorExpired", { path: "/cursor" });
  return Number(m[2]);
}
