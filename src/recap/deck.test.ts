import { describe, expect, it } from "vitest";
import { dayFromYmd as D, startOfDay } from "./days";
import { buildDeck, DECK_SIZE, type Deck } from "./deck";
import { eligibleGames, gameCount, isRight, makeGame, type GameType } from "./games";
import { mergePlays } from "./merge";
import { periodEnd, type Period } from "./periods";
import { seeded } from "./random";
import { buildContents } from "./slides";
import { buildSnapshot } from "./snapshot";
import { fits, STYLE_IDS, STYLES, styleMeta } from "./styles";
import { syntheticLog } from "./synthetic";

const data = mergePlays(syntheticLog(2026, D(2026, 11, 31)), []);
const oct: Period = { kind: "month", year: 2026, month: 9 };
const y2026: Period = { kind: "year", year: 2026 };
const month = buildSnapshot(oct, data, periodEnd(oct), startOfDay(D(2026, 10, 2)), { frozen: true, podcasts: false, youtube: false });
const year = buildSnapshot(y2026, data, periodEnd(y2026), startOfDay(D(2026, 11, 2)), { frozen: true, podcasts: false, youtube: false });

const cards = (d: Deck) => d.slides.filter((s) => !s.game);

function checkRules(d: Deck, kind: "month" | "year") {
  const s = d.slides;
  expect(s[0].kind).toBe("intro");
  expect(s.at(-1)!.kind).toBe(kind === "year" ? "finale" : "outro");
  for (const k of ["totalTime", "topArtist", "topTracks", "persona"]) expect(s.some((x) => x.kind === k), k).toBe(true);
  const [lo, hi] = DECK_SIZE[kind];
  expect(cards(d).length).toBeGreaterThanOrEqual(Math.min(lo, 12));
  expect(cards(d).length).toBeLessThanOrEqual(hi);
  // No two in a row share a style family.
  for (let i = 1; i < s.length; i++) {
    if (!s[i].style || !s[i - 1].style) continue;
    expect(styleMeta(s[i].style!).family, `slide ${i}`).not.toBe(styleMeta(s[i - 1].style!).family);
  }
  // A style repeats only once every style fitting that card (and allowed after the previous one) was used.
  const used = new Set<string>();
  for (let i = 0; i < s.length; i++) {
    const st = s[i].style;
    if (!st) continue;
    if (used.has(st)) {
      const shapes = [s[i].data, ...(s[i].alt ? [s[i].alt!] : [])];
      const prev = s[i - 1]?.style ? styleMeta(s[i - 1].style!).family : null;
      const unusedFitting = STYLE_IDS.filter((id) => !used.has(id) && styleMeta(id).family !== prev && shapes.some((x) => fits(id, x.shape, x.shape === "series" ? x.values.length : undefined)));
      expect(unusedFitting, `slide ${i} reused ${st}`).toEqual([]);
    }
    used.add(st);
    // The style can draw what it's given.
    const shown = s[i].useAlt ? s[i].alt! : s[i].data;
    expect(fits(st, shown.shape, shown.shape === "series" ? shown.values.length : undefined)).toBe(true);
  }
  // Games: never first or last, never back to back.
  s.forEach((x, i) => {
    if (!x.game) return;
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(s.length - 1);
    expect(s[i + 1].game).toBeUndefined();
  });
}

describe("buildDeck", () => {
  it("follows the rules for many seeds", () => {
    for (let seed = 1; seed <= 60; seed++) {
      checkRules(buildDeck(month, { seed, games: "sometimes" }), "month");
      checkRules(buildDeck(year, { seed, games: "always" }), "year");
    }
  });

  it("is deterministic per seed and differs between seeds", () => {
    const a = buildDeck(month, { seed: 5, games: "sometimes" });
    expect(buildDeck(month, { seed: 5, games: "sometimes" })).toEqual(a);
    const orders = new Set(Array.from({ length: 8 }, (_, i) => buildDeck(month, { seed: 100 + i, games: "never" }).slides.map((x) => `${x.kind}:${x.style}`).join()));
    expect(orders.size).toBeGreaterThan(4);
  });

  it("the yearly deck is longer, opens with a countdown and builds up to the top artist", () => {
    const d = buildDeck(year, { seed: 3, games: "never" });
    expect(cards(d).length).toBeGreaterThanOrEqual(20);
    expect(d.slides[0].style).toBe("countdown");
    const i = d.slides.findIndex((x) => x.kind === "topArtist");
    expect(d.slides[i - 1].kind).toBe("buildUp");
    expect(d.slides.some((x) => x.kind === "journey")).toBe(true);
  });

  it("games follow the setting and come before their answer", () => {
    expect(buildDeck(month, { seed: 1, games: "never" }).slides.some((x) => x.game)).toBe(false);
    let withGames = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const d = buildDeck(month, { seed, games: "sometimes" });
      const g = d.slides.filter((x) => x.game);
      if (g.length) withGames++;
      expect(g.length).toBeLessThanOrEqual(2);
      for (const [i, x] of d.slides.entries()) {
        if (!x.game?.before) continue;
        const reveal = d.slides.findIndex((y) => y.kind === x.game!.before);
        if (reveal >= 0) expect(reveal).toBeGreaterThan(i);
      }
    }
    expect(withGames).toBeGreaterThan(8);
    expect(withGames).toBeLessThan(32);
    expect(buildDeck(year, { seed: 2, games: "always" }).slides.filter((x) => x.game).length).toBe(3);
  });

  it("dev: forced style is used wherever it fits", () => {
    const d = buildDeck(month, { seed: 9, games: "never", forceStyle: "receipt" });
    expect(d.slides.filter((x) => x.style === "receipt").length).toBeGreaterThan(2);
  });
});

describe("copy", () => {
  it("every headline has at least three variants", () => {
    const heads = new Map<string, Set<string>>();
    for (let seed = 0; seed < 60; seed++)
      for (const c of buildContents(month.stats, { period: oct, label: "October", span: "this month", seed }, { coveredFrom: month.coveredFrom, periodStart: D(2026, 9, 1), youtube: false, log: true })) {
        if (!heads.has(c.kind)) heads.set(c.kind, new Set());
        heads.get(c.kind)!.add(c.headline);
      }
    for (const [kind, set] of heads) if (kind !== "comparison") expect(set.size, kind).toBeGreaterThanOrEqual(3);
  });

  it("no card says undefined or NaN", () => {
    for (const snap of [month, year])
      for (const s of buildDeck(snap, { seed: 4, games: "always" }).slides) expect(JSON.stringify([s.headline, s.sub, s.aria, s.data])).not.toMatch(/undefined|NaN/);
  });
});

describe("styles", () => {
  it("has at least 24 styles with unique ids and every shape covered twice", () => {
    expect(STYLES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(STYLE_IDS).size).toBe(STYLE_IDS.length);
    for (const shape of ["number", "rank", "hero", "series", "calendar", "pair", "text", "covers"] as const)
      expect(STYLE_IDS.filter((id) => fits(id, shape, 12)).length, shape).toBeGreaterThanOrEqual(2);
  });
});

describe("games", () => {
  it("decoys are real, unique, and the answer is always there", () => {
    for (const snap of [month, year]) {
      const types = eligibleGames(snap.stats, snap.period.kind);
      expect(types.length).toBeGreaterThanOrEqual(4);
      for (const type of types)
        for (let seed = 0; seed < 20; seed++) {
          const g = makeGame(type, snap.stats, seeded(seed));
          expect(g.rounds.length).toBeGreaterThan(0);
          for (const r of g.rounds) {
            const ids = r.options.map((o) => o.id);
            expect(new Set(ids).size, type).toBe(ids.length);
            expect(new Set(r.options.map((o) => o.label)).size, type).toBe(ids.length);
            for (const a of [r.answer].flat()) expect(ids).toContain(a);
            expect(isRight(r, r.answer)).toBe(true);
          }
        }
    }
  });

  it("each type needs its data", () => {
    const empty = buildSnapshot(oct, mergePlays([], []), periodEnd(oct), startOfDay(D(2026, 10, 2)), { frozen: true, podcasts: false, youtube: false });
    expect(eligibleGames(empty.stats, "month")).toEqual([]);
    const types: GameType[] = eligibleGames(year.stats, "year");
    expect(types).toContain("busiestMonth");
    expect(eligibleGames(month.stats, "month")).not.toContain("busiestMonth");
  });

  it("guess the hours has a right range", () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = makeGame("guessHours", month.stats, seeded(seed)).rounds[0];
      const right = r.options.find((o) => o.id === r.answer)!;
      const [lo, hi] = right.label.replace(/,/g, "").match(/\d+/g)!.map(Number);
      const h = month.stats.listenedMs / 3_600_000;
      expect(h >= lo && h <= hi).toBe(true);
    }
  });

  it("game counts", () => {
    expect(gameCount("never", "month", seeded(1))).toBe(0);
    expect(gameCount("never", "month", seeded(1), true)).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) {
      const n = gameCount("always", "month", seeded(i));
      expect(n >= 1 && n <= 2).toBe(true);
    }
  });
});
