import { springAt, SPRINGS } from "../motion";
import { lineAt, type LyricLine } from "./pick";

export const KARAOKE_STYLES = ["sweep", "glow", "bounce", "simple"] as const;
export type KaraokeStyle = (typeof KARAOKE_STYLES)[number];

export const KARAOKE_NAMES: Record<KaraokeStyle, string> = { sweep: "Sweep", glow: "Glow", bounce: "Bounce", simple: "Simple" };

export const normalizeKaraoke = (v: unknown): KaraokeStyle => ((KARAOKE_STYLES as readonly unknown[]).includes(v) ? (v as KaraokeStyle) : "sweep");

type Word = { start: number; end: number };

/** How far a word is sung at `ms`: 0 before it, 1 after it, linear in between (Sweep's fill). */
export function wordFill(w: Word, ms: number): number {
  if (ms <= w.start) return 0;
  if (ms >= w.end || w.end <= w.start) return 1;
  return (ms - w.start) / (w.end - w.start);
}

const GLOW_IN = 120;
const GLOW_OUT = 450;
/** Glow strength 0–1: in quickly when the word starts, out slowly after it ends. */
export function wordGlow(w: Word, ms: number): number {
  if (ms < w.start) return 0;
  if (ms < w.end) return Math.min(1, (ms - w.start) / GLOW_IN);
  const ramp = Math.min(1, (w.end - w.start) / GLOW_IN);
  return Math.max(0, ramp * (1 - (ms - w.end) / GLOW_OUT));
}

/** Bounce lift in px. Negative is up. */
export const LIFT = 4;
const BOUNCE = SPRINGS.fastSpatial;
const SETTLE_MS = 600;
/**
 * Bounce offset in px (negative = up): a spring toward the lift while the word is sung, back to rest after it ends.
 * A function of the playback clock, so seeking lands on the right pose and no second loop is needed.
 */
export function wordLift(w: Word, ms: number): number {
  if (ms < w.start) return 0;
  if (ms < w.end) return springAt(BOUNCE, 0, -LIFT, 0, (ms - w.start) / 1000).x;
  const at = springAt(BOUNCE, 0, -LIFT, 0, (w.end - w.start) / 1000);
  if (ms - w.end > SETTLE_MS) return 0;
  return springAt(BOUNCE, at.x, 0, at.v, (ms - w.end) / 1000).x;
}

/** An instrumental break shorter than this gets no dots. */
export const GAP_MS = 5000;

/** When a line stops being sung: its stated end, else its last word's; unknown for plain line-synced LRC. */
const lineEnd = (l: LyricLine) => l.end ?? l.words?.at(-1)?.end;

/**
 * Instrumental breaks of at least `min` ms, as `[before, from, to]`: the break before line `before`, from the end of
 * the line above it (or the song's start) to its start. Pure.
 */
export function gapsOf(lines: LyricLine[], min = GAP_MS): [number, number, number][] {
  const out: [number, number, number][] = [];
  lines.forEach((l, i) => {
    const from = i === 0 ? 0 : lineEnd(lines[i - 1]);
    if (from !== undefined && l.start - from >= min) out.push([i, from, l.start]);
  });
  return out;
}

// Break dots, after Apple Music's: they pop in, breathe slowly while lighting up one by one, then swell once and
// vanish just before the next line.
const GAP_IN_MS = 400;
const GAP_FADE_IN_MS = 160;
const GAP_OUT_MS = 450;
/** Half a breath (small → big). */
const GAP_BREATH_MS = 2500;
const GAP_SMALL = 0.85;
const GAP_BIG = 1.12;
const GAP_SWELL = 1.2;
/** The share of the exit spent swelling; the rest shrinks it away. */
const GAP_SWELL_SHARE = 0.35;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Break dots at `ms`: how lit dot `k` of 3 is (one after another until the exit), and the group's scale and
 * opacity. `breathe` off (the Simple style): the dots only light up.
 */
export function gapPose(from: number, to: number, ms: number, breathe: boolean): { dots: number[]; scale: number; opacity: number } {
  const t = ms - from;
  const length = Math.max(1, to - from);
  // Short breaks keep at least the pop-in before the exit.
  const exitAt = Math.max(Math.min(GAP_IN_MS, length), length - GAP_OUT_MS);
  const lit = clamp01(t / exitAt);
  const dots = [0, 1, 2].map((k) => clamp01(lit * 3 - k));
  if (!breathe) return { dots, scale: 1, opacity: 1 };
  if (t >= exitAt) {
    const p = clamp01((t - exitAt) / Math.max(1, length - exitAt));
    if (p <= GAP_SWELL_SHARE) return { dots, scale: GAP_SMALL + (GAP_SWELL - GAP_SMALL) * smooth(p / GAP_SWELL_SHARE), opacity: 1 };
    const q = smooth((p - GAP_SWELL_SHARE) / (1 - GAP_SWELL_SHARE));
    return { dots, scale: GAP_SWELL * (1 - q), opacity: 1 - q };
  }
  // The breath is timed backwards from the exit, so it is at its smallest when the swell starts.
  const mix = (1 + Math.cos((Math.PI * (exitAt - t)) / GAP_BREATH_MS)) / 2;
  const breath = GAP_SMALL + (GAP_BIG - GAP_SMALL) * mix;
  return { dots, scale: breath * easeOutExpo(clamp01(t / GAP_IN_MS)), opacity: clamp01(t / GAP_FADE_IN_MS) };
}

const round = (v: number, step: number) => Math.round(v / step) * step;

const resetGap = (el: HTMLElement) => {
  el.style.transform = "";
  el.style.opacity = "";
};

/**
 * Drives synced lyrics already rendered in `ol` (`li[data-i]` lines with `[data-w]` word and `[data-bw]` background
 * spans, `li[data-gap]` breaks with three `[data-d]` dots) from the playback clock: the current line (or break) gets
 * `data-active`, earlier lines `data-past`; on a word-synced line each word gets what the style needs — `data-on`
 * (sung), Sweep's `--k`, Glow's `--g` / `data-g`, Bounce's `top`; a break's dots get `--d` and the group a breathing
 * scale. Only the current line / break and the line just left are touched per frame, and only values that changed
 * are written. `onLine` hears which element became current.
 */
export function createKaraoke(ol: HTMLElement, lines: LyricLine[], style: KaraokeStyle, onLine?: (el: HTMLElement) => void) {
  const items = Array.from(ol.querySelectorAll<HTMLElement>(":scope > li[data-i]"));
  const words = items.map((li) => Array.from(li.querySelectorAll<HTMLElement>("[data-w]")));
  const backing = items.map((li) => Array.from(li.querySelectorAll<HTMLElement>("[data-bw]")));
  const gaps = Array.from(ol.querySelectorAll<HTMLElement>(":scope > li[data-gap]")).map((el) => ({
    el,
    from: Number(el.dataset.from),
    to: Number(el.dataset.to),
    dots: Array.from(el.querySelectorAll<HTMLElement>("[data-d]")),
  }));
  ol.dataset.k = style;
  let active = -2;
  let current: HTMLElement | null = null;
  let leaving = -1;
  // Last written values per word span, to skip writes that change nothing.
  const written = new WeakMap<HTMLElement, string>();
  const put = (el: HTMLElement, key: string, apply: () => void) => {
    if (written.get(el) === key) return;
    written.set(el, key);
    apply();
  };

  const paintWords = (timing: LyricLine["words"], spans: HTMLElement[] | undefined, ms: number) => {
    if (!timing || !spans) return;
    spans.forEach((el, k) => {
      const w = timing[k];
      if (!w) return;
      const on = w.start <= ms;
      if (style === "sweep") {
        const f = round(wordFill(w, ms), 0.002);
        put(el, `k${f}`, () => {
          el.style.setProperty("--k", String(f));
          el.toggleAttribute("data-on", on);
        });
      } else if (style === "glow") {
        const g = round(wordGlow(w, ms), 0.02);
        put(el, `g${g}${on}`, () => {
          el.toggleAttribute("data-on", on);
          el.toggleAttribute("data-g", g > 0);
          el.style.setProperty("--g", String(g));
        });
      } else if (style === "bounce") {
        const y = round(wordLift(w, ms), 0.1);
        put(el, `y${y}${on}`, () => {
          el.toggleAttribute("data-on", on);
          el.style.top = y ? `${y}px` : "";
        });
      } else put(el, `s${on}`, () => el.toggleAttribute("data-on", on));
    });
  };
  const paint = (i: number, ms: number) => {
    paintWords(lines[i]?.words, words[i], ms);
    paintWords(lines[i]?.background, backing[i], ms);
  };

  return {
    update(ms: number) {
      const sung = lineAt(lines, ms);
      const gap = gaps.find((g) => g.from <= ms && ms < g.to);
      // During a break the line above it is done: past, not current.
      const i = gap ? -1 : sung;
      const now = gap?.el ?? items[i] ?? null;
      if (i !== active || now !== current) {
        items.forEach((li, k) => {
          li.toggleAttribute("data-active", k === i);
          li.toggleAttribute("data-past", gap ? k <= sung : k < i);
        });
        for (const g of gaps) {
          g.el.toggleAttribute("data-active", g === gap);
          // A break left (or not reached yet) shows its dots at rest, not where its exit stopped.
          if (g !== gap) {
            resetGap(g.el);
            written.delete(g.el);
          }
        }
        if (active >= 0 && active !== i) leaving = active;
        active = i;
        current = now;
        if (now) onLine?.(now);
      }
      if (i >= 0) paint(i, ms);
      if (gap) {
        const pose = gapPose(gap.from, gap.to, ms, style !== "simple");
        gap.dots.forEach((d, k) => {
          const v = round(pose.dots[k], 0.02);
          put(d, `d${v}`, () => d.style.setProperty("--d", String(v)));
        });
        // Rounded, so a frame that wouldn't change a pixel writes nothing.
        const sc = round(pose.scale, 0.005);
        const op = round(pose.opacity, 0.02);
        put(gap.el, `s${sc}o${op}`, () => {
          gap.el.style.transform = sc === 1 ? "" : `scale(${sc})`;
          gap.el.style.opacity = op === 1 ? "" : String(op);
        });
      }
      // The line just left finishes its glow / settle, then is left alone.
      if (leaving >= 0 && leaving !== i) {
        paint(leaving, ms);
        const last = lines[leaving]?.words?.at(-1);
        if (!last || ms > last.end + SETTLE_MS || ms < lines[leaving].start) leaving = -1;
      }
    },
    /** Back to static lines (a style change or unmount). */
    dispose() {
      for (const spans of [...words, ...backing])
        for (const el of spans) {
          el.style.removeProperty("--k");
          el.style.removeProperty("--g");
          el.style.top = "";
          el.removeAttribute("data-g");
        }
      for (const g of gaps) resetGap(g.el);
      delete ol.dataset.k;
    },
  };
}
