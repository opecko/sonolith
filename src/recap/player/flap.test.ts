import { describe, expect, it } from "vitest";
import { flapLines } from "./styles/extra";

describe("split-flap rows", () => {
  it("wraps words instead of cutting them", () => {
    expect(flapLines(["9.4", "days nonstop", "or 25 long-haul flights"], 13, 7).map((r) => r.trimEnd())).toEqual(["9.4", "DAYS NONSTOP", "OR 25", "LONG-HAUL", "FLIGHTS"]);
  });
  it("leaves out a text that doesn't fit whole", () => {
    expect(flapLines(["one", "two words here and more"], 5, 3).map((r) => r.trim())).toEqual(["ONE"]);
  });
  it("splits a word longer than a row and pads every row", () => {
    const r = flapLines(["Supercalifragilistic"], 8, 5);
    expect(r).toEqual(["SUPERCAL", "IFRAGILI", "STIC    "]);
  });
  it("ranked lists stay one row per entry, accents stripped", () => {
    expect(flapLines(["1 Příliš dlouhý název písně"], 13, 7, true)).toEqual(["1 PRILIS DLO…"]);
  });
});
