import { Hct, hexFromArgb } from "@material/material-color-utilities";
import { contrast } from "./color";

/**
 * Recaps' colors: generated per recap from the dominant colors of its top covers (the same source colors "Colors
 * from album art" uses), in several moods so cards don't all look alike. Every text/background pair is checked
 * to reach WCAG 4.5:1; a tone that doesn't is pushed toward black or white until it does.
 */
export type RecapMood = "vivid" | "dark" | "pastel" | "duotone" | "contrast";
export const RECAP_MOODS: RecapMood[] = ["vivid", "dark", "pastel", "duotone", "contrast"];

export interface RecapPalette {
  mood: RecapMood;
  /** Card background and a second field for shapes and bands on it. */
  bg: string;
  bg2: string;
  /** Text on bg / bg2, and quieter text. */
  fg: string;
  muted: string;
  /** Highlight color (big numbers, shapes) and text on it. */
  accent: string;
  onAccent: string;
  /** Second highlight (duotone, chart series) and text on it. */
  accent2: string;
  onAccent2: string;
  /** The stage behind the card. */
  stage: string;
}

/** A pleasant violet when no cover could be read. */
const FALLBACK_SOURCE = 0xff6750a4;

const hex = (h: number, c: number, t: number) => hexFromArgb(Hct.from(h, c, Math.max(0, Math.min(100, t))).toInt()).toLowerCase();

/** `tone` of hue/chroma moved toward black or white (away from `bg`) until it reads on bg at 4.5:1. */
function readable(h: number, c: number, tone: number, bg: string, min = 4.5): string {
  const bgTone = Hct.fromInt(parseInt(bg.slice(1), 16) | 0xff000000).tone;
  const dir = tone < bgTone ? -1 : 1;
  let t = tone;
  let out = hex(h, c, t);
  for (let i = 0; i < 25 && contrast(out, bg) < min; i++) {
    t += dir * 4;
    out = hex(h, c * 0.9, t);
  }
  if (contrast(out, bg) >= min) return out;
  // A mid-tone background: whichever end reads better.
  return contrast("#000000", bg) >= contrast("#ffffff", bg) ? "#000000" : "#ffffff";
}

/** Hues of up to two distinct source colors (the second at least 40° away, else a complementary-ish one). */
export function sourceHues(sources: number[]): [number, number, number] {
  const hcts = (sources.length ? sources : [FALLBACK_SOURCE]).map((s) => Hct.fromInt(s));
  const a = hcts[0];
  const far = hcts.slice(1).find((h) => Math.min(Math.abs(h.hue - a.hue), 360 - Math.abs(h.hue - a.hue)) >= 40);
  return [a.hue, far ? far.hue : (a.hue + 150) % 360, a.chroma];
}

export function recapPalette(sources: number[], mood: RecapMood): RecapPalette {
  const [h1, h2, chroma] = sourceHues(sources);
  // Grey covers get a gently colored palette rather than a grey one.
  const c = Math.max(chroma, 24);
  let bg: string, bg2: string, accent: string, accent2: string, stage: string;
  switch (mood) {
    case "vivid":
      bg = hex(h1, Math.max(c, 56), 38);
      bg2 = hex(h1, Math.max(c, 56), 30);
      accent = hex(h2, 72, 82);
      accent2 = hex((h1 + 30) % 360, 60, 70);
      stage = hex(h1, 30, 12);
      break;
    case "dark":
      bg = hex(h1, 14, 8);
      bg2 = hex(h1, 18, 14);
      accent = hex(h1, Math.max(c, 48), 74);
      accent2 = hex(h2, 52, 70);
      stage = hex(h1, 10, 4);
      break;
    case "pastel":
      bg = hex(h1, 28, 90);
      bg2 = hex(h1, 34, 84);
      accent = hex(h1, Math.max(c, 50), 40);
      accent2 = hex(h2, 40, 50);
      stage = hex(h1, 20, 76);
      break;
    case "duotone":
      bg = hex(h1, Math.max(c, 64), 26);
      bg2 = hex(h2, 64, 34);
      accent = hex(h2, 70, 84);
      accent2 = hex(h1, 60, 84);
      stage = hex(h1, 30, 10);
      break;
    case "contrast":
      bg = "#050505";
      bg2 = hex(h1, 6, 12);
      accent = hex(h1, Math.max(c, 80), 86);
      accent2 = "#ffffff";
      stage = "#000000";
      break;
  }
  const light = Hct.fromInt(parseInt(bg.slice(1), 16) | 0xff000000).tone > 50;
  const fg = readable(h1, 6, light ? 10 : 97, bg);
  // Quieter text, still 4.5:1 on both fields.
  const mutedOn = readable(h1, 16, light ? 32 : 80, bg);
  const muted = contrast(mutedOn, bg2) >= 4.5 ? mutedOn : readable(h1, 12, light ? 20 : 90, bg2);
  const textOn = (fill: string) => {
    const dark = contrast("#000000", fill) >= contrast("#ffffff", fill);
    return readable(h1, 8, dark ? 8 : 98, fill);
  };
  return { mood, bg, bg2, fg: contrast(fg, bg2) >= 4.5 ? fg : readable(h1, 6, light ? 4 : 99, bg2), muted, accent, onAccent: textOn(accent), accent2, onAccent2: textOn(accent2), stage };
}

/** The palette as CSS custom properties for the recap stage (`var(--rc-bg)` …). */
export function recapVars(p: RecapPalette): Record<string, string> {
  return {
    "--rc-bg": p.bg,
    "--rc-bg2": p.bg2,
    "--rc-fg": p.fg,
    "--rc-muted": p.muted,
    "--rc-accent": p.accent,
    "--rc-on-accent": p.onAccent,
    "--rc-accent2": p.accent2,
    "--rc-on-accent2": p.onAccent2,
    "--rc-stage": p.stage,
  };
}

/** Confetti and sticker colors from a palette (a few tints of the two accents). */
export const recapConfetti = (p: RecapPalette) => [p.accent, p.accent2, p.fg, p.bg2];
