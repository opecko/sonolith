// Which recap the story player shows (it's a full-window overlay above everything, App.tsx mounts it).
import { create } from "zustand";
import type { Deck } from "./deck";
import type { Snapshot } from "./snapshot";
import type { StyleId } from "./styles";

export interface PlayerOpen {
  snapshot: Snapshot;
  seed: number;
  /** Card to start at (resume). */
  start: number;
  /** Dev toolkit: always games / one style where it fits. */
  forceGames?: boolean;
  forceStyle?: StyleId | null;
  /** A ready-made deck (the dev toolkit's style gallery) instead of one built from the snapshot. */
  deck?: Deck;
}

export const useRecapUi = create<{ open: PlayerOpen | null }>(() => ({ open: null }));

const RESUME_KEY = "recap-resume";

/** Where the user left a recap: the same seed (same cards) and the card index. */
function readResume(): { id: string; seed: number; index: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "null");
    return v && typeof v.id === "string" && Number.isInteger(v.seed) && Number.isInteger(v.index) ? v : null;
  } catch {
    return null;
  }
}

export function saveResume(id: string, seed: number, index: number) {
  try {
    if (index <= 0) localStorage.removeItem(RESUME_KEY);
    else localStorage.setItem(RESUME_KEY, JSON.stringify({ id, seed, index }));
  } catch {
    /* storage unavailable: no resume */
  }
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Opens the player; continues where the user left this recap unless `fresh` (Replay) or dev options are given. */
export function openRecapPlayer(snapshot: Snapshot, opts: { fresh?: boolean; forceGames?: boolean; forceStyle?: StyleId | null } = {}) {
  const r = readResume();
  const resume = !opts.fresh && !opts.forceStyle && !opts.forceGames && r?.id === snapshot.id ? r : null;
  useRecapUi.setState({ open: { snapshot, seed: resume?.seed ?? newSeed(), start: resume?.index ?? 0, forceGames: opts.forceGames, forceStyle: opts.forceStyle } });
}

export const closeRecapPlayer = () => useRecapUi.setState({ open: null });
