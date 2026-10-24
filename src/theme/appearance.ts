import { isHex } from "./color";
import type { ThemeChoice } from "./index";
import { BUILTIN_ID } from "./palettes";
import { DEFAULT_TOKENS } from "./tokens";

/** Everything under Settings → Appearance; also the shape of an exported theme file. */
export const COVER_COLORS = ["off", "app", "nowPlaying"] as const;
export type CoverColors = (typeof COVER_COLORS)[number];
/** The choices as the Settings and onboarding dropdowns name them. */
export const COVER_COLOR_OPTIONS: readonly { value: CoverColors; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "app", label: "Whole app" },
  { value: "nowPlaying", label: "Now Playing only" },
];

export interface Appearance extends ThemeChoice {
  /** Blurred artwork light behind Now Playing. */
  ambient: boolean;
  /** Ambient strength, 0–1. */
  ambientIntensity: number;
  /** Ambient smoothness: how many colors are sampled and how big the canvas they're spread over is. */
  ambientQuality: AmbientQuality;
  /** "Colors from album art": the scheme generated from the current cover (the palette as fallback), for the whole
   * app or only Now Playing. */
  coverColors: CoverColors;
  /** Corner radius in px. */
  radius: number;
  density: "normal" | "compact";
  /** UI scale, 0.9–1.25. */
  zoom: number;
  /** "app" = Sonolith's own font stack, "system"/"mono" = the system's UI/monospace font, "custom" = `fontFamily`. */
  font: FontKind;
  /** An installed font family, used when `font` is "custom". */
  fontFamily: string;
  /** "m3" = Material 3 Expressive, "classic" = the look from before 2.0. */
  uiStyle: UiStyle;
  /** Now Playing layout; independent of `uiStyle`. */
  nowPlayingLayout: NowPlayingLayout;
  /** Springs, shape morphs and slides; off = everything jumps to its end state. */
  animations: boolean;
}

export const AMBIENT_QUALITIES = ["low", "medium", "high"] as const;
export type AmbientQuality = (typeof AMBIENT_QUALITIES)[number];
export const UI_STYLES = ["m3", "classic"] as const;
export type UiStyle = (typeof UI_STYLES)[number];
export const NOW_PLAYING_LAYOUTS = ["material", "bento", "classic"] as const;
export type NowPlayingLayout = (typeof NOW_PLAYING_LAYOUTS)[number];

/** The OS asks for reduced motion (the default for `animations`); false where there's no matchMedia (tests). */
export function systemReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export const FONT_KINDS = ["app", "system", "mono", "custom"] as const;
export type FontKind = (typeof FONT_KINDS)[number];

export const DEFAULT_APPEARANCE: Appearance = {
  palette: BUILTIN_ID,
  mode: "dark",
  overrides: {},
  ambient: true,
  ambientIntensity: 0.8,
  ambientQuality: "medium",
  coverColors: "off",
  radius: 8,
  density: "normal",
  zoom: 1,
  font: "app",
  fontFamily: "",
  uiStyle: "m3",
  nowPlayingLayout: "material",
  animations: true,
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
    ambientQuality: AMBIENT_QUALITIES.includes(r.ambientQuality as AmbientQuality) ? (r.ambientQuality as AmbientQuality) : d.ambientQuality,
    // Was a switch (on = the whole app); before 2.0 "Accent from artwork" (coverAccent): on stays on.
    coverColors: COVER_COLORS.includes(r.coverColors as CoverColors) ? (r.coverColors as CoverColors)
      : typeof r.coverColors === "boolean" ? (r.coverColors ? "app" : "off")
      : typeof r.coverAccent === "boolean" ? (r.coverAccent ? "app" : "off") : d.coverColors,
    radius: num(r.radius, 0, 24, d.radius),
    density: r.density === "compact" ? "compact" : "normal",
    zoom: num(r.zoom, 0.9, 1.25, d.zoom),
    font: FONT_KINDS.includes(r.font as FontKind) ? (r.font as FontKind) : d.font,
    fontFamily: typeof r.fontFamily === "string" ? r.fontFamily.slice(0, 200) : d.fontFamily,
    // Settings from before 2.0 have none of these: existing users get the new look, like a fresh install.
    uiStyle: UI_STYLES.includes(r.uiStyle as UiStyle) ? (r.uiStyle as UiStyle) : d.uiStyle,
    nowPlayingLayout: NOW_PLAYING_LAYOUTS.includes(r.nowPlayingLayout as NowPlayingLayout) ? (r.nowPlayingLayout as NowPlayingLayout) : d.nowPlayingLayout,
    animations: typeof r.animations === "boolean" ? r.animations : !systemReducedMotion(),
  };
}
