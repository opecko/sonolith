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

// OKLCH, for mixing two hues without passing through grey (CSS `color-mix(in oklch, …)`).
const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function toOklch({ r, g, b }: Rgba): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

function fromOklch(L: number, C: number, H: number): Omit<Rgba, "a"> {
  const A = C * Math.cos((H * Math.PI) / 180), B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

/** Like `mix`, interpolated in OKLCH along the shorter hue arc (as CSS color-mix does). */
export function mixOklch(a: string, b: string, t: number): string {
  const x = parseHex(a), y = parseHex(b);
  if (!x || !y) return a;
  const [l1, c1, h1] = toOklch(x), [l2, c2, h2] = toOklch(y);
  let dh = h2 - h1;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  // A grey has no hue; it takes the other color's (CSS "powerless" hue).
  const h = c1 < 1e-4 ? h2 : c2 < 1e-4 ? h1 : h1 + dh * t;
  return toHex({ ...fromOklch(l1 + (l2 - l1) * t, c1 + (c2 - c1) * t, h), a: x.a + (y.a - x.a) * t });
}
