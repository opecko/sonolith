import { describe, expect, it } from "vitest";
import { placeMenu } from "./menuPlace";

describe("menu placement", () => {
  it("opens below when it fits there, as tall as the room", () => {
    expect(placeMenu({ top: 100, bottom: 132 }, 300, 800)).toEqual({ up: false, top: 136, maxHeight: 656 });
  });

  it("opens above when it only fits there", () => {
    expect(placeMenu({ top: 600, bottom: 632 }, 400, 800)).toEqual({ up: true, top: 596, maxHeight: 588 });
  });

  it("too tall for both: the roomier side, scrolling past it", () => {
    expect(placeMenu({ top: 300, bottom: 332 }, 2000, 800)).toEqual({ up: false, top: 336, maxHeight: 456 });
    expect(placeMenu({ top: 500, bottom: 532 }, 2000, 800)).toEqual({ up: true, top: 496, maxHeight: 488 });
  });

  it("a right-click point is its own anchor", () => {
    expect(placeMenu({ top: 790, bottom: 790 }, 200, 800, 0)).toEqual({ up: true, top: 790, maxHeight: 782 });
  });
});
