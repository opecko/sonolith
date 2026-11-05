// Smoke test of the story player's navigation over a real deck (no browser: the rules are pure), and the style
// registry staying in step with the renderers.
import { describe, expect, it } from "vitest";
import { dayFromYmd as D, startOfDay } from "../days";
import { buildDeck } from "../deck";
import { mergePlays } from "../merge";
import { periodEnd, type Period } from "../periods";
import { buildSnapshot } from "../snapshot";
import { STYLE_IDS } from "../styles";
import { syntheticLog } from "../synthetic";
import { autoAdvancing, clickAction, keyAction, step } from "./nav";
import { STYLE_COMPONENTS } from "./styles";

const oct: Period = { kind: "month", year: 2026, month: 9 };
const snap = buildSnapshot(oct, mergePlays(syntheticLog(2026, D(2026, 10, 1)), []), periodEnd(oct), startOfDay(D(2026, 10, 2)), { frozen: true, podcasts: false, youtube: false });

describe("story player navigation", () => {
  const deck = buildDeck(snap, { seed: 11, games: "always" });
  const n = deck.slides.length;

  it("walks the whole deck with → and back with ←, stopping at games", () => {
    let i = 0;
    const seen = [i];
    for (let k = 0; k < n * 2; k++) {
      const a = keyAction("ArrowRight", { game: !!deck.slides[i].game, inControl: false });
      // A game holds → until answered (the card calls "next" itself).
      i = step(i, n, a ?? "next");
      seen.push(i);
    }
    expect(i).toBe(n - 1);
    expect(new Set(seen).size).toBe(n);
    for (let k = 0; k < n; k++) i = step(i, n, keyAction("ArrowLeft", { game: false, inControl: false })!);
    expect(i).toBe(0);
    expect(step(3, n, "end")).toBe(n - 1);
  });

  it("keys and clicks", () => {
    expect(keyAction("Escape", { game: true, inControl: true })).toBe("close");
    expect(keyAction(" ", { game: false, inControl: false })).toBe("pause");
    expect(keyAction(" ", { game: false, inControl: true })).toBeNull();
    expect(keyAction("ArrowRight", { game: true, inControl: false })).toBeNull();
    expect(keyAction("k", { game: false, inControl: false })).toBeNull();
    expect(clickAction(0.1, false)).toBe("prev");
    expect(clickAction(0.5, false)).toBe("next");
    expect(clickAction(0.9, true)).toBeNull();
  });

  it("auto-advance stops for pause, holds, games, hidden windows and the last card", () => {
    const on = { autoAdvance: true, paused: false, held: false, hidden: false, game: false, last: false, duration: 6000 };
    expect(autoAdvancing(on)).toBe(true);
    for (const k of ["paused", "held", "hidden", "game", "last"] as const) expect(autoAdvancing({ ...on, [k]: true })).toBe(false);
    expect(autoAdvancing({ ...on, autoAdvance: false })).toBe(false);
  });

  it("every card of a deck has a renderer", () => {
    for (const s of deck.slides) if (s.style) expect(STYLE_COMPONENTS[s.style]).toBeTypeOf("function");
    expect(Object.keys(STYLE_COMPONENTS).sort()).toEqual([...STYLE_IDS].sort());
  });
});
