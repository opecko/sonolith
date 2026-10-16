import type { ComponentType } from "react";
import { create } from "zustand";

/**
 * Where the dev toolkit (src/dev, loaded only by `npm run tauri dev`) plugs in: its top-bar chip, and hooks the
 * app asks only inside `if (import.meta.env.DEV)` (dead code in release builds). In release builds src/dev isn't
 * bundled at all, so nothing can ever fill this.
 */
export const useDevSlot = create<{
  chip: ComponentType | null;
  /** "Don't save played tracks to history" is on (the flag itself lives in src/dev, in memory only). */
  skipHistory?: () => boolean;
}>(() => ({ chip: null }));
