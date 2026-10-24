import { describe, expect, it } from "vitest";
import type { Track } from "../api/types";
import { append, dedupe, insertNext, reorder } from "./queueOps";

const q = (ids: string, auto = ""): Track[] =>
  ids.split("").map((id) => ({ type: "track", id, title: id, subtitle: "", artists: [], ...(auto.includes(id) ? { source: "autoplay" as const } : {}) }));
const ids = (r: { queue: Track[] } | null) => r!.queue.map((t) => t.id).join("");

describe("reorder", () => {
  it("keeps the index on the playing track", () => {
    expect(reorder(q("abcde"), 2, 0, 4)).toMatchObject({ index: 1 }); // moved from before current to after
    expect(ids(reorder(q("abcde"), 2, 0, 4))).toBe("bcdea");
    expect(reorder(q("abcde"), 2, 4, 0)).toMatchObject({ index: 3 });
    expect(reorder(q("abcde"), 2, 2, 4)).toMatchObject({ index: 4 }); // dragging the playing track itself
    expect(reorder(q("abcde"), 2, 3, 4)).toMatchObject({ index: 2 }); // both after current
  });
  it("promotes an autoplay track dragged into the real queue", () => {
    const r = reorder(q("abcXY", "XY"), 0, 4, 1)!;
    expect(ids(r)).toBe("aYbcX");
    expect(r.queue[1].source).toBeUndefined();
    expect(reorder(q("abcXYZ", "XYZ"), 0, 5, 4)!.queue[4].source).toBe("autoplay"); // dropped among autoplay
    expect(reorder(q("abcXY", "XY"), 0, 1, 4)!.queue[4].source).toBeUndefined(); // real track stays real
  });
  it("ignores no-op and out-of-range moves", () => {
    expect(reorder(q("abc"), 0, 1, 1)).toBeNull();
    expect(reorder(q("abc"), 0, 5, 1)).toBeNull();
    expect(reorder(q("abc"), 0, 1, 9)).toBeNull();
  });
});

describe("insertNext / append", () => {
  it("plays a whole album next, moving up songs already queued later", () => {
    const r = insertNext(q("abcde"), 1, q("dxyx"));
    expect(ids(r)).toBe("abdxyce");
    expect(r.added.map((t) => t.id).join("")).toBe("dxy");
  });
  it("never moves the playing track", () => {
    expect(ids(insertNext(q("abc"), 1, q("bx")))).toBe("abxc");
  });
  it("appends only songs not still to come", () => {
    const r = append(q("abcd"), 2, q("aceef"));
    expect(ids(r)).toBe("abcdaef"); // "a" was already played, so it comes again; "c" is playing, "e" listed twice
    expect(append(q("ab"), 0, q("b")).added).toHaveLength(0);
  });
  it("appends above the upcoming autoplay tracks", () => {
    const queue = q("abcd").map((t, i) => (i >= 2 ? { ...t, source: "autoplay" as const } : t));
    expect(ids(append(queue, 0, q("x")))).toBe("abxcd");
    // Autoplay tracks already playing or played stay where they are.
    expect(ids(append(queue, 3, q("x")))).toBe("abcdx");
  });
  it("dedupes in order", () => {
    expect(dedupe(q("abab c")).map((t) => t.id).join("")).toBe("ab c");
  });
});
