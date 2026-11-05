// The deck builder: which cards a viewing shows, in what order, in which style and mood, and where games go. Pure,
// with an injected seed: the frozen numbers stay the same, the presentation is new each viewing (Replay reshuffles).
//
// Rules: intro first and outro (yearly: the finale poster) last; total time, top artist, top songs and the persona are
// always there; no two cards in a row share a style family; no style repeats until every style that fits has been
// used; games never come first or last, never back to back, and come right before the card that reveals their answer.
import { RECAP_MOODS, type RecapMood } from "../theme/recapPalette";
import { eligibleGames, gameCount, makeGame, type Game } from "./games";
import { MONTHS } from "./days";
import { pickOne, seeded, shuffle } from "./random";
import { buildContents, type SlideContent, type SlideKind } from "./slides";
import type { Snapshot } from "./snapshot";
import { fits, STYLE_IDS, styleMeta, type StyleId } from "./styles";

export interface Slide extends SlideContent {
  /** The style drawing it; null for the special cards (finale poster, games). */
  style: StyleId | null;
  mood: RecapMood;
  /** Drawn from `alt` (the style fits the alternative shape). */
  useAlt: boolean;
  game?: Game;
}

export interface Deck {
  seed: number;
  slides: Slide[];
}

export interface DeckOptions {
  seed: number;
  games: "sometimes" | "always" | "never";
  /** Dev toolkit: always include games / use this style wherever it fits. */
  forceGames?: boolean;
  forceStyle?: StyleId | null;
}

export const DECK_SIZE = { month: [10, 14], year: [20, 28] } as const;

/** Cards every recap has. */
export const REQUIRED: SlideKind[] = ["intro", "totalTime", "topArtist", "topTracks", "persona", "outro", "finale"];
const ARTIST_BLOCK: SlideKind[] = ["buildUp", "topArtist", "topArtists"];
const SONG_BLOCK: SlideKind[] = ["topTrack", "topTracks"];

export function buildDeck(snap: Snapshot, opts: DeckOptions): Deck {
  const rng = seeded(opts.seed);
  const year = snap.period.kind === "year";
  const label = snap.period.kind === "year" ? String(snap.period.year) : MONTHS[snap.period.month];
  const all = buildContents(snap.stats, { period: snap.period, label, span: year ? "this year" : "this month", seed: opts.seed }, {
    coveredFrom: snap.coveredFrom,
    periodStart: firstDayOfPeriod(snap),
    youtube: snap.sources.youtube,
    log: snap.sources.log,
    takeout: snap.sources.takeout,
  });
  const byKind = new Map(all.map((c) => [c.kind, c]));
  const take = (k: SlideKind) => {
    const c = byKind.get(k);
    byKind.delete(k);
    return c;
  };

  const [lo, hi] = DECK_SIZE[snap.period.kind];
  const target = lo + Math.floor(rng() * (hi - lo + 1));
  const intro = take("intro")!;
  const end = take(year ? "finale" : "outro")!;
  const total = take("totalTime")!;
  const persona = take("persona")!;
  // Yearly always builds up to the top artist; monthly sometimes.
  if (!year && rng() < 0.5) byKind.delete("buildUp");
  const artistBlock = ARTIST_BLOCK.map(take).filter((c): c is SlideContent => !!c);
  const songBlock = SONG_BLOCK.map(take).filter((c): c is SlideContent => !!c);
  // Optional cards: the rest, shuffled, as many as the target allows (yearly keeps its journey).
  let rest = shuffle(rng, [...byKind.values()]);
  if (year) rest = [...rest.filter((c) => c.kind === "journey"), ...rest.filter((c) => c.kind !== "journey")];
  const fixed = 4 + artistBlock.length + songBlock.length;
  rest = shuffle(rng, rest.slice(0, Math.max(0, target - fixed)));
  // Spread the optional cards before, between and after the two big blocks.
  const a = Math.ceil(rest.length * 0.55), b = Math.min(rest.length, a + 1 + Math.floor(rng() * 2));
  const order: SlideContent[] = [intro, total, ...rest.slice(0, a), ...artistBlock, ...rest.slice(a, b), ...songBlock, ...rest.slice(b), persona, end];

  const slides: Slide[] = order.map((c) => ({ ...c, style: null, mood: "dark", useAlt: false }));
  insertGames(slides, snap, opts, rng);
  assignStyles(slides, year, opts.forceStyle ?? null, rng);
  let prevMood: RecapMood | null = null;
  for (const s of slides) {
    s.mood = pickOne(rng, RECAP_MOODS.filter((m) => m !== prevMood));
    prevMood = s.mood;
  }
  return { seed: opts.seed, slides };
}

/** The period's first day (stats count the period's days up to the last one). */
const firstDayOfPeriod = (snap: Snapshot) => snap.lastDay - snap.stats.daysInPeriod + 1;

function insertGames(slides: Slide[], snap: Snapshot, opts: DeckOptions, rng: () => number) {
  const n = gameCount(opts.games, snap.period.kind, rng, opts.forceGames);
  if (!n) return;
  const types = shuffle(rng, eligibleGames(snap.stats, snap.period.kind)).slice(0, n);
  for (const type of types) {
    const game = makeGame(type, snap.stats, rng);
    const card: Slide = {
      kind: "game",
      data: { shape: "text", big: game.title, lines: [] },
      headline: game.title,
      aria: `${game.title}: ${game.rounds[0].question}`,
      duration: 0,
      style: null,
      mood: "dark",
      useAlt: false,
      game,
    };
    let at = game.before ? slides.findIndex((s) => s.kind === game.before && !s.game) : -1;
    // Before the build-up when the answer's card has one.
    if (at > 0 && slides[at - 1].kind === "buildUp") at--;
    if (at <= 0 || slides[at - 1]?.game || slides[at]?.game) {
      const free = slides.map((_, i) => i).filter((i) => i >= 2 && i <= slides.length - 1 && !slides[i - 1].game && !slides[i]?.game);
      if (!free.length) continue;
      at = pickOne(rng, free);
    }
    slides.splice(at, 0, card);
  }
}

function assignStyles(slides: Slide[], year: boolean, force: StyleId | null, rng: () => number) {
  const used = new Set<StyleId>();
  let prevFamily: string | null = null;
  for (const [i, s] of slides.entries()) {
    if (s.game || s.kind === "finale") {
      prevFamily = s.game ? "game" : "finale";
      continue;
    }
    const shapes = [s.data, ...(s.alt ? [s.alt] : [])];
    const fitting = (id: StyleId) => shapes.some((d) => fits(id, d.shape, d.shape === "series" ? d.values.length : undefined));
    let choice: StyleId | null = null;
    if (force && fitting(force) && styleMeta(force).family !== prevFamily) choice = force;
    else if (i === 0 && year) choice = "countdown";
    else {
      const ok = STYLE_IDS.filter((id) => fitting(id) && styleMeta(id).family !== prevFamily);
      const fresh = ok.filter((id) => !used.has(id));
      choice = pickOne(rng, fresh.length ? fresh : ok);
    }
    s.style = choice;
    s.useAlt = !fits(choice, s.data.shape, s.data.shape === "series" ? s.data.values.length : undefined);
    used.add(choice);
    prevFamily = styleMeta(choice).family;
  }
}

