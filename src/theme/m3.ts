import { mix, mixOklch } from "./color";
import type { Token, TokenMap } from "./tokens";

/**
 * Material 3 color roles, derived from the `--c-*` tokens so every palette, custom color and the artwork accent
 * work in the M3 style too. Each role is a token, another role, or a mix of two of them. m3.css holds the same
 * recipes as CSS `color-mix()` (a test keeps them in sync); `m3Roles` computes them for contrast checks.
 */
type Ref = `c:${Token}` | `m3:${string}`;
type Recipe = Ref | { mix: [Ref, number, Ref]; space?: "oklch" };

export const M3_RECIPES = {
  primary: "c:accent",
  "on-primary": "c:on-accent",
  "primary-container": { mix: ["c:accent", 22, "c:bg"] },
  "on-primary-container": { mix: ["c:accent", 15, "c:text"] },
  secondary: "c:accent-2",
  "on-secondary": "c:bg",
  // Tonal buttons and active indicators: a quiet wash, not a second accent. Container / on-container ratios are
  // tuned so text on them keeps 4.5:1 for every bundled palette whose own text has 7:1 (m3.test.ts).
  "secondary-container": { mix: ["c:accent-2", 15, "m3:surface-container-low"] },
  "on-secondary-container": { mix: ["c:accent-2", 12, "c:text"] },
  // A third hue between the two accents (OKLCH keeps it saturated where sRGB would turn grey).
  tertiary: { mix: ["c:accent", 50, "c:accent-2"], space: "oklch" },
  "on-tertiary": "c:bg",
  "tertiary-container": { mix: ["m3:tertiary", 22, "c:bg"] },
  "on-tertiary-container": { mix: ["m3:tertiary", 15, "c:text"] },
  error: "c:error",
  "on-error": "c:bg",
  "error-container": { mix: ["c:error", 22, "c:bg"] },
  "on-error-container": { mix: ["c:error", 15, "c:text"] },
  surface: "c:bg",
  // Surfaces carry a trace of the accent, like M3's tinted neutrals.
  "surface-tint": { mix: ["c:accent", 4, "c:bg"] },
  "surface-container-lowest": "c:bg",
  "surface-container-low": { mix: ["c:text", 5, "m3:surface-tint"] },
  "surface-container": { mix: ["c:text", 8, "m3:surface-tint"] },
  "surface-container-high": { mix: ["c:text", 11, "m3:surface-tint"] },
  "surface-container-highest": { mix: ["c:text", 15, "m3:surface-tint"] },
  "on-surface": "c:text",
  "on-surface-variant": "c:text-muted",
  outline: { mix: ["c:text", 40, "c:bg"] },
  "outline-variant": "c:outline",
  "inverse-surface": "c:text",
  "inverse-on-surface": "c:bg",
  "inverse-primary": { mix: ["c:accent", 70, "c:bg"] },
  scrim: "c:scrim",
} satisfies Record<string, Recipe>;

export type M3Role = keyof typeof M3_RECIPES;
export const M3_ROLES = Object.keys(M3_RECIPES) as M3Role[];

const cssRef = (r: Ref) => (r.startsWith("c:") ? `var(--c-${r.slice(2)})` : `var(--m3-${r.slice(3)})`);

/** The declarations m3.css has on :root, one per role. */
export function m3Declarations(): string[] {
  return M3_ROLES.map((role) => {
    const r: Recipe = M3_RECIPES[role];
    if (typeof r === "string") return `--m3-${role}: ${cssRef(r)};`;
    const [a, pct, b] = r.mix;
    return `--m3-${role}: color-mix(in ${r.space ?? "srgb"}, ${cssRef(a)} ${pct}%, ${cssRef(b)});`;
  });
}

/** What each role resolves to for these token values (CSS color-mix(A p%, B) = B blended toward A by p). */
export function m3Roles(tokens: TokenMap): Record<M3Role, string> {
  const out = {} as Record<M3Role, string>;
  const get = (r: Ref): string => (r.startsWith("c:") ? tokens[r.slice(2) as Token] : resolve(r.slice(3) as M3Role));
  const resolve = (role: M3Role): string => {
    if (out[role]) return out[role];
    const r: Recipe = M3_RECIPES[role];
    if (typeof r === "string") return (out[role] = get(r));
    const [a, pct, b] = r.mix;
    return (out[role] = (r.space === "oklch" ? mixOklch : mix)(get(b), get(a), pct / 100));
  };
  for (const role of M3_ROLES) resolve(role);
  return out;
}

/** Text-on-container pairs the M3 style relies on; Settings warns when a palette or custom color breaks one. */
export const M3_CONTRAST_PAIRS: { fg: M3Role; bg: M3Role; label: string }[] = [
  { fg: "on-primary-container", bg: "primary-container", label: "Text on primary containers (New playlist, card play buttons)" },
  { fg: "on-secondary-container", bg: "secondary-container", label: "Text on tonal buttons and selected items" },
  { fg: "on-tertiary-container", bg: "tertiary-container", label: "Text on tertiary containers" },
  { fg: "on-surface", bg: "surface-container-high", label: "Text on cards and dialogs" },
];
