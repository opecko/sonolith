import { create } from "zustand";
import type { Credits } from "../api/types";

type CreditsState = { status: "loading" } | { status: "ok"; data: Credits } | { status: "error"; message: string };

interface UiState {
  nowPlaying: boolean;
  /** Now Playing fully covers the app (slide-in done): the content underneath is hidden so it isn't repainted. */
  nowPlayingCovering: boolean;
  setNowPlaying: (open: boolean) => void;
  setNowPlayingCovering: (covering: boolean) => void;
  /** Podcast episodes: show the video in Now Playing instead of the artwork. */
  podcastVideo: boolean;
  setPodcastVideo: (on: boolean) => void;
  /** "View song credits" dialog. */
  credits: CreditsState | null;
  setCredits: (c: CreditsState | null) => void;
  /** "Try out the new looks" card at the top of Now Playing (from What's new). */
  tryLooks: boolean;
  setTryLooks: (on: boolean) => void;
  /** History rows removed this session (by their removal token), hidden until the page reloads. */
  removedHistory: Set<string>;
  markRemovedHistory: (token: string) => void;
}

export const useUi = create<UiState>((set) => ({
  nowPlaying: false,
  nowPlayingCovering: false,
  setNowPlaying: (nowPlaying) => set(nowPlaying ? { nowPlaying } : { nowPlaying, nowPlayingCovering: false }),
  setNowPlayingCovering: (nowPlayingCovering) => set({ nowPlayingCovering }),
  podcastVideo: false,
  setPodcastVideo: (podcastVideo) => set({ podcastVideo }),
  credits: null,
  setCredits: (credits) => set({ credits }),
  tryLooks: false,
  setTryLooks: (tryLooks) => set({ tryLooks }),
  removedHistory: new Set(),
  markRemovedHistory: (token) => set((s) => ({ removedHistory: new Set(s.removedHistory).add(token) })),
}));
