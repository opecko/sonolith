import { describe, expect, it } from "vitest";
import type { Page } from "../api/types";
import { ApiError } from "./errors";
import { page, slice, sliceCursor } from "./paging";

/** A source of `sizes` pages, items numbered from 0. */
function source(sizes: number[]) {
  let fetched = 0;
  const at = (i: number, start: number): Page<number> => ({
    items: Array.from({ length: sizes[i] }, (_, k) => start + k),
    loadMore: i + 1 < sizes.length ? async () => { fetched++; return at(i + 1, start + sizes[i]); } : null,
  });
  return { first: async () => { fetched++; return at(0, 0); }, fetched: () => fetched };
}

describe("page", () => {
  it("fills a page from several source pages and keeps the rest for the cursor", async () => {
    const s = source([3, 3, 3]);
    const a = await page("k", undefined, 4, s.first, (x) => x);
    expect(a.items).toEqual([0, 1, 2, 3]);
    const b = await page("k", a.nextCursor!, 4, s.first, (x) => x);
    expect(b.items).toEqual([4, 5, 6, 7]);
    const c = await page("k", b.nextCursor!, 4, s.first, (x) => x);
    expect(c).toEqual({ items: [8], nextCursor: null });
    expect(s.fetched()).toBe(3);
  });

  it("drops unmapped items", async () => {
    const r = await page("k", undefined, 10, source([5]).first, (x) => (x % 2 ? null : x));
    expect(r).toEqual({ items: [0, 2, 4], nextCursor: null });
  });

  it("rejects cursors of another list, used ones and old ones", async () => {
    const s = source([3, 3]);
    const a = await page("k", undefined, 2, s.first, (x) => x, 0);
    await expect(page("other", a.nextCursor!, 2, s.first, (x) => x, 0)).rejects.toBeInstanceOf(ApiError);
    await expect(page("k", a.nextCursor!, 2, s.first, (x) => x, 0)).rejects.toMatchObject({ reason: "cursorExpired" });
    const b = await page("k", undefined, 2, s.first, (x) => x, 0);
    await expect(page("k", b.nextCursor!, 2, s.first, (x) => x, 31 * 60_000)).rejects.toMatchObject({ reason: "cursorExpired" });
  });
});

describe("slice", () => {
  it("pages a list for one revision", () => {
    const a = slice([1, 2, 3, 4, 5], 0, 2, 7);
    expect(a.items).toEqual([1, 2]);
    const from = sliceCursor(a.nextCursor!, 7);
    expect(slice([1, 2, 3, 4, 5], from, 10, 7)).toEqual({ items: [3, 4, 5], nextCursor: null });
    expect(() => sliceCursor(a.nextCursor!, 8)).toThrow(ApiError);
  });
});
