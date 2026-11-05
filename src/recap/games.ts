// Little games between recap cards. Each type appears only when the stats support it; wrong answers ("decoys") come
// from the user's own data, never invented, never duplicated, and the right answer is always among the options.
// Friendly either way: there's nothing to lose.
import { MONTHS } from "./days";
import { duration, fmtInt, HOURS_LABEL, minutesOf, plural } from "./format";
import { shuffle, type Rng } from "./random";
import type { RecapStats } from "./stats";

export type GameType = "guessArtist" | "guessSong" | "higherLower" | "guessHours" | "busiestMonth" | "rankTop3" | "mostSkipped" | "peakHour";

export interface GameOption {
  id: string;
  label: string;
  sub?: string;
  image?: string;
}

export interface GameRound {
  question: string;
  options: GameOption[];
  /** The right option id; for "rankTop3" the ids in the right order. */
  answer: string | string[];
  /** Shown after answering, right or wrong. */
  reveal: string;
  /** A number to count up to on the reveal (hours). */
  revealValue?: number;
}

export interface Game {
  type: GameType;
  /** The card this game leads into (its answer is revealed there too), if any. */
  before?: "topArtist" | "topTracks" | "topTrack" | "journey" | "hours" | "mostSkipped" | "totalTime" | "topArtists";
  title: string;
  rounds: GameRound[];
}

const distinctPlays = <T extends { plays: number }>(list: T[]) => new Set(list.map((x) => x.plays)).size === list.length;

/** Which game types the stats support. */
export function eligibleGames(s: RecapStats, kind: "month" | "year"): GameType[] {
  const out: GameType[] = [];
  if (s.topArtists.length >= 3 && s.topArtists[0].plays > s.topArtists[1].plays) out.push("guessArtist");
  if (s.topTracks.length >= 3 && s.topTracks[0].plays > s.topTracks[1].plays) out.push("guessSong");
  if (higherLowerPairs(s).length >= 2) out.push("higherLower");
  if (s.listenedMs >= 3 * 3_600_000) out.push("guessHours");
  if (kind === "year" && s.journey && s.journey.filter((m) => m.plays > 0).length >= 4) out.push("busiestMonth");
  if (s.topArtists.length >= 3 && distinctPlays(s.topArtists.slice(0, 3))) out.push("rankTop3");
  if (s.mostSkipped && s.topTracks.some((t) => t.key !== s.mostSkipped!.track.key)) out.push("mostSkipped");
  if (s.byHour && s.byHour.some((n) => n > 0)) out.push("peakHour");
  return out;
}

function higherLowerPairs(s: RecapStats) {
  const pool = [...s.topArtists.map((a) => ({ id: `a:${a.key}`, label: a.name, sub: "Artist", image: a.thumbnail, plays: a.plays })),
    ...s.topTracks.map((t) => ({ id: `t:${t.key}`, label: t.title, sub: t.artist, image: t.thumbnail, plays: t.plays }))];
  const pairs: [typeof pool[number], typeof pool[number]][] = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++)
      if (pool[i].plays !== pool[j].plays && pool[i].id.slice(0, 2) === pool[j].id.slice(0, 2)) pairs.push([pool[i], pool[j]]);
  return pairs;
}

/** Builds a game of the given type (it must be eligible). Options are shuffled; ids are unique. */
export function makeGame(type: GameType, s: RecapStats, rng: Rng): Game {
  switch (type) {
    case "guessArtist": {
      const opts = s.topArtists.slice(0, 4).map((a) => ({ id: a.key, label: a.name, image: a.thumbnail }));
      const a = s.topArtists[0];
      return { type, before: "topArtist", title: "Quick question", rounds: [{ question: "Who was your #1 artist?", options: shuffle(rng, opts), answer: a.key, reveal: `${a.name}, with ${plural(a.plays, "play")}.` }] };
    }
    case "guessSong": {
      const opts = s.topTracks.slice(0, 4).map((t) => ({ id: t.key, label: t.title, sub: t.artist, image: t.thumbnail }));
      const t = s.topTracks[0];
      return { type, before: "topTracks", title: "Guess the song", rounds: [{ question: "Which song did you play the most?", options: shuffle(rng, opts), answer: t.key, reveal: `"${t.title}", ${plural(t.plays, "time")}.` }] };
    }
    case "higherLower": {
      const picks = shuffle(rng, higherLowerPairs(s));
      const used = new Set<string>();
      const rounds: GameRound[] = [];
      for (const [x, y] of picks) {
        if (rounds.length >= 3 || used.has(x.id) || used.has(y.id)) continue;
        used.add(x.id), used.add(y.id);
        const [l, r] = rng() < 0.5 ? [x, y] : [y, x];
        const win = l.plays > r.plays ? l : r;
        rounds.push({
          question: "Which did you play more?",
          options: [l, r].map(({ id, label, sub, image }) => ({ id, label, sub, image })),
          answer: win.id,
          reveal: `${win.label}: ${plural(win.plays, "play")} vs ${fmtInt(Math.min(l.plays, r.plays))}.`,
        });
      }
      return { type, title: "Higher or lower", rounds };
    }
    case "guessHours": {
      const h = s.listenedMs / 3_600_000;
      // Four ranges of equal width around the real value, the right one at a random position.
      const width = h < 20 ? 5 : h < 80 ? 20 : h < 300 ? 50 : 200;
      const slot = Math.floor(rng() * 4);
      const start = Math.max(0, Math.floor(h / width) - slot) * width;
      const options = [0, 1, 2, 3].map((i) => ({ id: `r${i}`, label: `${fmtInt(start + i * width)}–${fmtInt(start + (i + 1) * width)} hours` }));
      const right = options[Math.min(3, Math.floor((h - start) / width))].id;
      return { type, before: "totalTime", title: "Guess the hours", rounds: [{ question: "How many hours did you listen?", options, answer: right, reveal: `${duration(s.listenedMs)} — that's ${fmtInt(minutesOf(s.listenedMs))} minutes.`, revealValue: Math.round(h) }] };
    }
    case "busiestMonth": {
      const months = s.journey!.filter((m) => m.plays > 0);
      const top = months.reduce((b, m) => (m.listenedMs > b.listenedMs ? m : b));
      const decoys = shuffle(rng, months.filter((m) => m !== top)).slice(0, 3);
      const options = shuffle(rng, [top, ...decoys]).map((m) => ({ id: `m${m.month}`, label: MONTHS[m.month] }));
      return { type, before: "journey", title: "Busiest month", rounds: [{ question: "Which month did you listen the most?", options, answer: `m${top.month}`, reveal: `${MONTHS[top.month]}: ${duration(top.listenedMs)}.` }] };
    }
    case "rankTop3": {
      const top = s.topArtists.slice(0, 3);
      return {
        type, before: "topArtists", title: "Rank your top 3",
        rounds: [{ question: "Tap your top 3 artists in order, #1 first.", options: shuffle(rng, top.map((a) => ({ id: a.key, label: a.name, image: a.thumbnail }))), answer: top.map((a) => a.key), reveal: top.map((a, i) => `${i + 1}. ${a.name}`).join("  ") }],
      };
    }
    case "mostSkipped": {
      const sk = s.mostSkipped!.track;
      const decoys = s.topTracks.filter((t) => t.key !== sk.key).slice(0, 3);
      const options = shuffle(rng, [sk, ...decoys].map((t) => ({ id: t.key, label: t.title, sub: t.artist, image: t.thumbnail })));
      return { type, before: "mostSkipped", title: "Skip it", rounds: [{ question: "Which song did you skip the most?", options, answer: sk.key, reveal: `"${sk.title}", skipped ${plural(s.mostSkipped!.skips, "time")}.` }] };
    }
    case "peakHour": {
      // Four 6-hour windows; the answer is the one holding the most plays.
      const windows = [0, 6, 12, 18].map((from) => ({ from, n: s.byHour!.slice(from, from + 6).reduce((a, b) => a + b, 0) }));
      const best = windows.reduce((b, w) => (w.n > b.n ? w : b));
      const names = ["Night", "Morning", "Afternoon", "Evening"];
      const options = windows.map((w, i) => ({ id: `w${w.from}`, label: names[i], sub: `${HOURS_LABEL(w.from)}–${HOURS_LABEL((w.from + 6) % 24)}` }));
      const peak = s.byHour!.indexOf(Math.max(...s.byHour!));
      return { type, before: "hours", title: "Peak listening", rounds: [{ question: "When do you listen the most?", options, answer: `w${best.from}`, reveal: `${names[windows.indexOf(best)]}, peaking around ${HOURS_LABEL(peak)}.` }] };
    }
  }
}

/** Whether an answer is right (a rank must match in full). */
export function isRight(round: GameRound, answer: string | string[]): boolean {
  return Array.isArray(round.answer) ? Array.isArray(answer) && answer.join("|") === round.answer.join("|") : answer === round.answer;
}

/** Result copy: friendly, never a punishment. */
export function resultLine(right: boolean, rng: Rng): string {
  const yes = ["Nailed it!", "You know yourself well.", "Spot on."];
  const no = ["So close!", "Plot twist!", "Not quite, but who's counting?"];
  const list = right ? yes : no;
  return list[Math.floor(rng() * list.length)];
}

/**
 * How many games a viewing gets: "never" none; "always" 1–2 (yearly 3); "sometimes" about half of the viewings,
 * then 1–2 (yearly up to 3).
 */
export function gameCount(setting: "sometimes" | "always" | "never", kind: "month" | "year", rng: Rng, force = false): number {
  if (setting === "never" && !force) return 0;
  if (setting === "sometimes" && !force && rng() >= 0.5) return 0;
  return kind === "year" ? (setting === "always" || force ? 3 : 1 + Math.floor(rng() * 3)) : 1 + Math.floor(rng() * 2);
}
