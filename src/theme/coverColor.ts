import { contrast, mix, toHex } from "./color";
import type { TokenMap } from "./tokens";

/**
 * Dominant vivid color of RGBA pixels: colors are bucketed (4 bits per channel) and weighted by saturation, so a
 * small saturated area beats a large gray one. All-gray artwork gives its most common color.
 */
export function dominantColor(px: Uint8ClampedArray): string | null {
  const buckets = new Map<number, { w: number; r: number; g: number; b: number; n: number }>();
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    // Near-black and near-white say little about the artwork's color.
    const w = 0.05 + sat * sat * (max < 40 || min > 225 ? 0.2 : 1);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0, n: 0 };
    e.w += w;
    e.r += r;
    e.g += g;
    e.b += b;
    e.n++;
    buckets.set(key, e);
  }
  let best: { w: number; r: number; g: number; b: number; n: number } | undefined;
  for (const e of buckets.values()) if (!best || e.w > best.w) best = e;
  return best ? toHex({ r: best.r / best.n, g: best.g / best.n, b: best.b / best.n, a: 1 }) : null;
}

/** Accent tokens for an artwork color: nudged toward the text color until it stands out from the background. */
export function coverAccentTokens(color: string, bg: string, text: string): Partial<TokenMap> {
  let accent = color;
  for (let t = 0.1; contrast(accent, bg) < 3 && t <= 1; t += 0.1) accent = mix(color, text, t);
  const onAccent = contrast("#ffffff", accent) >= contrast("#000000", accent) ? "#ffffff" : "#000000";
  return { accent, "on-accent": onAccent, "slider-fill": accent };
}
