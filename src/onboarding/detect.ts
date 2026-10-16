/** localStorage keys any earlier ytdesk (1.x included) wrote, besides "settings". */
export const PRIOR_KEYS = ["volume", "queue-v1", "colorEditorView"] as const;

/** What startup knows without asking anything slow. */
export interface LocalData {
  /** The stored settings object, or null when there was none. */
  settings: Record<string, unknown> | null;
  /** Which of PRIOR_KEYS were present. */
  keys: string[];
}

/** Evidence that needs a call: the sign-in cookie in the keyring, the native config / downloaded yt-dlp. */
export interface NativeData {
  cookie: boolean;
  nativeFiles: boolean;
}

/**
 * "done": onboarding was completed. "show": a fresh install, or one whose onboarding was left unfinished.
 * "existing": an install from before onboarding existed (it gets marked completed silently). "ask": nothing
 * local says either way; the native evidence decides (decideWithNative).
 */
export type Decision = "done" | "show" | "existing" | "ask";

/**
 * The fast part. Settings with `onboardingCompleted` tell it directly (true: done; false: started, not finished).
 * Settings without it come from a version before onboarding: existing. No settings: any other stored key means
 * existing; otherwise the keyring and disk decide. `lastSeenVersion` alone can't tell: 1.x never wrote it.
 */
export function decideLocal({ settings, keys }: LocalData): Decision {
  if (settings) {
    if (settings.onboardingCompleted === true) return "done";
    if (settings.onboardingCompleted === false) return "show";
    return "existing";
  }
  return keys.length ? "existing" : "ask";
}

/** The slow part, only when decideLocal said "ask": a cookie or native files mean an existing install. */
export const decideWithNative = (n: NativeData): "show" | "existing" => (n.cookie || n.nativeFiles ? "existing" : "show");
