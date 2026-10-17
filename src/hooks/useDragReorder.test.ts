import { describe, expect, it } from "vitest";
import { dropIndex, moveItem } from "./useDragReorder";

describe("drag reorder", () => {
  it("drop slots become the item's new index", () => {
    expect(dropIndex(0, { i: 2, pos: "before" })).toBe(1);
    expect(dropIndex(0, { i: 2, pos: "after" })).toBe(2);
    expect(dropIndex(3, { i: 0, pos: "before" })).toBe(0);
    expect(dropIndex(3, { i: 3, pos: "after" })).toBe(3);
  });
  it("moves an item", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 1, 9)).toEqual(["a", "b"]);
  });
});
