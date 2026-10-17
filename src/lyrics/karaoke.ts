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

/** Breathing dots: how lit dot `k` of 3 is (they light up one by one across the break) and the group's scale. */
export function gapPose(from: number, to: number, ms: number, breathe: boolean): { dots: number[]; scale: number } {
  const p = Math.min(1, Math.max(0, (ms - from) / (to - from)));
  const dots = [0, 1, 2].map((k) => Math.min(1, Math.max(0, p * 3 - k)));
  if (!breathe) return { dots, scale: 1 };
  // A slow breath; it shrinks away over the last half second so the next line takes over.
  const fade = Math.min(1, Math.max(0, (to - ms) / 500));
  return { dots, scale: (1 + 0.1 * Math.sin((2 * Math.PI * (ms - from)) / 1800)) * fade };
}

const round = (v: number, step: number) => Math.round(v / step) * step;

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
        for (const g of gaps) g.el.toggleAttribute("data-active", g === gap);
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
        const sc = round(pose.scale, 0.005);
        put(gap.el, `s${sc}`, () => (gap.el.style.transform = sc === 1 ? "" : `scale(${sc})`));
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
      for (const g of gaps) g.el.style.transform = "";
      delete ol.dataset.k;
    },
  };
}
