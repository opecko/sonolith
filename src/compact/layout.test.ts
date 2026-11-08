import { describe, expect, it } from "vitest";
import { COMPACT_MIN, FULL_MIN, columnCoverSize, compactShape, grownSize, rowCoverSize, windowMode } from "./layout";

describe("windowMode", () => {
  it("keeps the full layout from its minimum up", () => {
    expect(windowMode(FULL_MIN.width, FULL_MIN.height)).toBe("full");
    expect(windowMode(1200, 780)).toBe("full");
  });

  it("is compact when either side is below the full minimum", () => {
    expect(windowMode(FULL_MIN.width - 1, 800)).toBe("compact");
    expect(windowMode(1200, FULL_MIN.height - 1)).toBe("compact");
    expect(windowMode(COMPACT_MIN.width, COMPACT_MIN.height)).toBe("compact");
  });

  it("is tiny when either side is below the mini player's minimum", () => {
    expect(windowMode(COMPACT_MIN.width - 1, 600)).toBe("tiny");
    expect(windowMode(600, COMPACT_MIN.height - 1)).toBe("tiny");
    expect(windowMode(100, 80)).toBe("tiny");
  });

  it("treats an unknown size as full", () => {
    expect(windowMode(0, 0)).toBe("full");
    expect(windowMode(NaN, 500)).toBe("full");
    expect(windowMode(300, -1)).toBe("full");
  });
});

describe("compactShape", () => {
  it("stacks the cover on top when there's height", () => {
    expect(compactShape(260, 300)).toBe("column");
    expect(compactShape(470, 600)).toBe("column");
  });

  it("puts the cover beside the controls in a short, wide window", () => {
    expect(compactShape(400, 200)).toBe("row");
    expect(compactShape(1200, 299)).toBe("row");
  });

  it("falls back to a small thumbnail when short and narrow", () => {
    expect(compactShape(399, 200)).toBe("stack");
    expect(compactShape(220, 150)).toBe("stack");
  });
});

describe("columnCoverSize", () => {
  it("fits the narrower of width and the height left over", () => {
    expect(columnCoverSize(300, 600, 240)).toBe(268);
    expect(columnCoverSize(470, 420, 240)).toBe(180);
  });

  it("stays between 64 and 360", () => {
    expect(columnCoverSize(1000, 1000, 100)).toBe(360);
    expect(columnCoverSize(220, 300, 280)).toBe(64);
  });
});

describe("rowCoverSize", () => {
  it("fills the height but leaves the width to the controls", () => {
    expect(rowCoverSize(1000, 200)).toBe(176);
    expect(rowCoverSize(460, 250)).toBe(166);
    expect(rowCoverSize(1000, 299)).toBe(240);
    expect(rowCoverSize(100, 100)).toBe(64);
  });
});

describe("grownSize", () => {
  it("grows to the default and never shrinks", () => {
    expect(grownSize(300, 200)).toEqual({ width: 960, height: 640 });
    expect(grownSize(1400, 300.4)).toEqual({ width: 1400, height: 640 });
  });
});
