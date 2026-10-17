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

const round = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Drives synced lyrics already rendered in `ol` (`li[data-i]` lines, `[data-w]` word spans) from the playback clock:
 * the current line gets `data-active`, earlier ones `data-past`; on a word-synced line each word gets what the style
 * needs — `data-on` (sung), Sweep's `--k`, Glow's `--g` / `data-g`, Bounce's `top`. Only the current line and the
 * one just left are touched per frame, and only values that changed are written. `onLine` hears line changes.
 */
export function createKaraoke(ol: HTMLElement, lines: LyricLine[], style: KaraokeStyle, onLine?: (i: number) => void) {
  const items = Array.from(ol.querySelectorAll<HTMLElement>(":scope > li[data-i]"));
  const words = items.map((li) => Array.from(li.querySelectorAll<HTMLElement>("[data-w]")));
  ol.dataset.k = style;
  let active = -2;
  let leaving = -1;
  // Last written values per word span, to skip writes that change nothing.
  const written = new WeakMap<HTMLElement, string>();
  const put = (el: HTMLElement, key: string, apply: () => void) => {
    if (written.get(el) === key) return;
    written.set(el, key);
    apply();
  };

  const paint = (i: number, ms: number) => {
    const timing = lines[i]?.words;
    const spans = words[i];
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

  return {
    update(ms: number) {
      const i = lineAt(lines, ms);
      if (i !== active) {
        items.forEach((li, k) => {
          li.toggleAttribute("data-active", k === i);
          li.toggleAttribute("data-past", k < i);
        });
        if (active >= 0) leaving = active;
        active = i;
        onLine?.(i);
      }
      if (i >= 0) paint(i, ms);
      // The line just left finishes its glow / settle, then is left alone.
      if (leaving >= 0 && leaving !== i) {
        paint(leaving, ms);
        const last = lines[leaving]?.words?.at(-1);
        if (!last || ms > last.end + SETTLE_MS || ms < lines[leaving].start) leaving = -1;
      }
    },
    /** Back to static lines (a style change or unmount). */
    dispose() {
      for (const spans of words)
        for (const el of spans) {
          el.style.removeProperty("--k");
          el.style.removeProperty("--g");
          el.style.top = "";
          el.removeAttribute("data-g");
        }
      delete ol.dataset.k;
    },
  };
}
