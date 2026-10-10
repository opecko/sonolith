/** Small sRGB helpers for theme tokens: everything is kept as #rrggbb or #rrggbbaa so it fits <input type="color">. */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const isHex = (s: string) => HEX.test(s.trim());

export function parseHex(s: string): Rgba | null {
  const m = HEX.exec(s.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");

export function toHex({ r, g, b, a }: Rgba): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ""}`;
}

/** `a` blended toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return a;
  const l = (p: number, q: number) => p + (q - p) * t;
  return toHex({ r: l(x.r, y.r), g: l(x.g, y.g), b: l(x.b, y.b), a: l(x.a, y.a) });
}

export function withAlpha(c: string, alpha: number): string {
  const x = parseHex(c);
  return x ? toHex({ ...x, a: x.a * alpha }) : c;
}

/** Opaque color of `fg` painted over `bg` (alpha compositing). */
export function over(fg: string, bg: string): string {
  const f = parseHex(fg), b = parseHex(bg);
  if (!f || !b) return fg;
  return toHex({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
}

function luminance(c: Rgba): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/** WCAG contrast ratio of `fg` (composited over `bg`) against `bg`. */
export function contrast(fg: string, bg: string): number {
  const b = parseHex(over(bg, "#000000"));
  const f = parseHex(over(fg, toHex(b ?? { r: 0, g: 0, b: 0, a: 1 })));
  if (!f || !b) return 1;
  const [hi, lo] = [luminance(f), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

export const isLight = (c: string) => {
  const x = parseHex(c);
  return !!x && luminance(x) > 0.4;
};
