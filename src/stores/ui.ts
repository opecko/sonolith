import { create } from "zustand";
import type { Credits } from "../api/types";

type CreditsState = { status: "loading" } | { status: "ok"; data: Credits } | { status: "error"; message: string };

interface UiState {
  nowPlaying: boolean;
  /** Now Playing fully covers the app (slide-in done): the content underneath is hidden so it isn't repainted. */
  nowPlayingCovering: boolean;
  setNowPlaying: (open: boolean) => void;
  setNowPlayingCovering: (covering: boolean) => void;
  /** Podcast episodes and music videos: show the video in Now Playing instead of the artwork (a song has none). */
  showVideo: boolean;
  setShowVideo: (on: boolean) => void;
  /** "View song credits" dialog. */
  credits: CreditsState | null;
  setCredits: (c: CreditsState | null) => void;
  /**
   * The layout switcher card at the top of Now Playing: "whatsNew" ("Try out the new looks", from What's new),
   * "settings" ("Try out the different styles", from Settings → Now Playing), null: hidden.
   */
  tryLooks: "whatsNew" | "settings" | null;
  setTryLooks: (from: "whatsNew" | "settings" | null) => void;
  /** History rows removed this session (by their removal token), hidden until the page reloads. */
  removedHistory: Set<string>;
  markRemovedHistory: (token: string) => void;
}

export const useUi = create<UiState>((set) => ({
  nowPlaying: false,
  nowPlayingCovering: false,
  setNowPlaying: (nowPlaying) => set(nowPlaying ? { nowPlaying } : { nowPlaying, nowPlayingCovering: false }),
  setNowPlayingCovering: (nowPlayingCovering) => set({ nowPlayingCovering }),
  showVideo: false,
  setShowVideo: (showVideo) => set({ showVideo }),
  credits: null,
  setCredits: (credits) => set({ credits }),
  tryLooks: null,
  setTryLooks: (tryLooks) => set({ tryLooks }),
  removedHistory: new Set(),
  markRemovedHistory: (token) => set((s) => ({ removedHistory: new Set(s.removedHistory).add(token) })),
}));
