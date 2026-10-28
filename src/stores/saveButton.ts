/**
 * Now Playing's Save button (Settings → Now Playing): what a click does. "picker" opens the list of the user's
 * playlists, "direct" saves straight into the one picked in Settings, "off" leaves the button out.
 */
export type SaveAction = "picker" | "direct" | "off";

export interface SaveButtonSettings {
  action: SaveAction;
  /** The playlist "direct" saves into (its title is kept for the button's tooltip until the library has loaded). */
  playlist: { id: string; title: string } | null;
}

export const DEFAULT_SAVE_BUTTON: SaveButtonSettings = { action: "picker", playlist: null };

const ACTIONS: readonly SaveAction[] = ["picker", "direct", "off"];

/** Stored value → settings; anything missing or malformed falls back to the default. */
export function normalizeSaveButton(raw: unknown): SaveButtonSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as { action?: unknown; playlist?: { id?: unknown; title?: unknown } | null };
  const p = r.playlist;
  const playlist = p && typeof p.id === "string" && p.id && typeof p.title === "string" ? { id: p.id, title: p.title } : null;
  return { action: ACTIONS.includes(r.action as SaveAction) ? (r.action as SaveAction) : DEFAULT_SAVE_BUTTON.action, playlist };
}

/**
 * What the button does right now: nothing to show ("hidden": off, or signed out, since saving needs an account),
 * the picker, saving into the chosen playlist, or, for "direct" without a usable playlist (none chosen, or one
 * no longer in the library), asking the user to choose one.
 */
export function saveBehavior(
  s: SaveButtonSettings,
  signedIn: boolean,
  library: readonly { id: string; title: string }[] | null,
): { kind: "hidden" } | { kind: "picker" } | { kind: "direct"; id: string; title: string } | { kind: "choose" } {
  if (s.action === "off" || !signedIn) return { kind: "hidden" };
  if (s.action === "picker") return { kind: "picker" };
  if (!s.playlist) return { kind: "choose" };
  // The library not loaded yet: trust the stored choice (a deleted playlist fails with a toast when saving).
  if (!library) return { kind: "direct", ...s.playlist };
  const now = library.find((p) => p.id === s.playlist!.id);
  return now ? { kind: "direct", id: now.id, title: now.title } : { kind: "choose" };
}
