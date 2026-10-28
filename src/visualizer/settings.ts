/** Where the Now Playing visualizer draws: nowhere, along the bottom of the overlay, over the cover, or as a glow around it. */
export type VisualizerMode = "off" | "background" | "cover" | "halo";
/** How the spectrum is drawn in the Background and Cover modes (Halo is always a glow). */
export type VisualizerStyle = "bars" | "wave";

export interface VisualizerSettings {
  mode: VisualizerMode;
  style: VisualizerStyle;
  /** Keep it moving, at a lower frame rate, while another window has focus (a second monitor). */
  unfocused: boolean;
}

export const VISUALIZER_MODES: readonly VisualizerMode[] = ["off", "background", "cover", "halo"];
export const VISUALIZER_STYLES: readonly VisualizerStyle[] = ["bars", "wave"];
export const DEFAULT_VISUALIZER: VisualizerSettings = { mode: "off", style: "bars", unfocused: true };

/** Stored value → settings; anything missing or unknown falls back to the default. */
export function normalizeVisualizer(raw: unknown): VisualizerSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof VisualizerSettings, unknown>>;
  return {
    mode: VISUALIZER_MODES.includes(r.mode as VisualizerMode) ? (r.mode as VisualizerMode) : DEFAULT_VISUALIZER.mode,
    style: VISUALIZER_STYLES.includes(r.style as VisualizerStyle) ? (r.style as VisualizerStyle) : DEFAULT_VISUALIZER.style,
    unfocused: typeof r.unfocused === "boolean" ? r.unfocused : DEFAULT_VISUALIZER.unfocused,
  };
}
