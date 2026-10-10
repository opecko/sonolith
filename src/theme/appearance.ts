import { isHex } from "./color";
import type { ThemeChoice } from "./index";
import { BUILTIN_ID } from "./palettes";
import { DEFAULT_TOKENS } from "./tokens";

/** Everything under Settings → Appearance; also the shape of an exported theme file. */
export interface Appearance extends ThemeChoice {
  /** Blurred artwork light behind Now Playing. */
  ambient: boolean;
  /** Ambient strength, 0–1. */
  ambientIntensity: number;
  /** Accent taken from the current track's artwork (palette accent as fallback). */
  coverAccent: boolean;
  /** Corner radius in px. */
  radius: number;
  density: "normal" | "compact";
  /** UI scale, 0.9–1.25. */
  zoom: number;
}

export const DEFAULT_APPEARANCE: Appearance = {
  palette: BUILTIN_ID,
  mode: "dark",
  overrides: {},
  ambient: true,
  ambientIntensity: 0.8,
  coverAccent: false,
  radius: 8,
  density: "normal",
  zoom: 1,
};

const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

/** Coerces stored or imported data into a valid Appearance; anything missing or malformed falls back to the default. */
export function normalizeAppearance(raw: unknown): Appearance {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_APPEARANCE;
  const overrides: Appearance["overrides"] = {};
  if (r.overrides && typeof r.overrides === "object") {
    for (const [k, v] of Object.entries(r.overrides as Record<string, unknown>)) {
      if (k in DEFAULT_TOKENS && typeof v === "string" && isHex(v)) overrides[k as keyof typeof DEFAULT_TOKENS] = v.trim().toLowerCase();
    }
  }
  return {
    palette: typeof r.palette === "string" && r.palette ? r.palette : d.palette,
    mode: r.mode === "light" ? "light" : "dark",
    overrides,
    ambient: typeof r.ambient === "boolean" ? r.ambient : d.ambient,
    ambientIntensity: num(r.ambientIntensity, 0, 1, d.ambientIntensity),
    coverAccent: typeof r.coverAccent === "boolean" ? r.coverAccent : d.coverAccent,
    radius: num(r.radius, 0, 24, d.radius),
    density: r.density === "compact" ? "compact" : "normal",
    zoom: num(r.zoom, 0.9, 1.25, d.zoom),
  };
}
