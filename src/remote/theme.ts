// The colors the phone remote page gets: the app's resolved tokens (Rust keeps only known names with hex values).
import { isLight } from "../theme/color";
import type { TokenMap } from "../theme/tokens";

/** Tokens the page uses (src-tauri/src/remote/theme.rs keeps the same list). */
export const REMOTE_TOKENS = [
  "bg", "surface", "surface-2", "surface-3", "text", "text-muted", "text-subtle", "accent", "on-accent", "accent-2",
  "outline", "hover", "active", "error", "slider-track",
] as const;

export interface RemoteTheme {
  tokens: Record<string, string>;
  light: boolean;
}

export function remoteTheme(all: TokenMap): RemoteTheme {
  const tokens: Record<string, string> = {};
  for (const k of REMOTE_TOKENS) if (all[k]) tokens[k] = all[k];
  return { tokens, light: isLight(all.bg) };
}
