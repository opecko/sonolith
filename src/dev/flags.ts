import { create } from "zustand";

/**
 * Dev-only switches. In memory only (never persisted): a release build has no way to read or set them, and a
 * restart of the dev app clears them.
 */
export const useDevFlags = create<{ noHistory: boolean; setNoHistory: (on: boolean) => void }>((set) => ({
  noHistory: false,
  setNoHistory: (noHistory) => set({ noHistory }),
}));
