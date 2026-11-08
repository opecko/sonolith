import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import { openSettings, useNav } from "../stores/nav";
import { setAppearance, useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";
import { WHATS_NEW } from "./entries";
import { pickWhatsNew } from "./select";
import type { WhatsNewAction, WhatsNewChore, WhatsNewEntry } from "./types";

export const useWhatsNew = create<{ entry: WhatsNewEntry | null; show: (e: WhatsNewEntry | null) => void }>((set) => ({
  entry: null,
  show: (entry) => set({ entry }),
}));

/** Runs one of the typed actions, then closes the dialog. */
export function runWhatsNewAction(a: WhatsNewAction) {
  useWhatsNew.getState().show(null);
  switch (a.type) {
    case "openSettings":
      useUi.getState().setNowPlaying(false);
      openSettings(a.section, a.focus);
      break;
    case "setNowPlayingLayout":
      setAppearance({ nowPlayingLayout: a.layout });
      if (a.tryCard) useUi.getState().setTryLooks("whatsNew");
      if (a.open) useUi.getState().setNowPlaying(true);
      break;
    case "openRecaps":
      useUi.getState().setNowPlaying(false);
      useNav.getState().go({ name: "recaps" });
      break;
  }
}

function runChore(c: WhatsNewChore) {
  switch (c) {
    case "clearLyricsCache":
      // Lyrics picked by older rules are found again with the new ones, the playing track's included.
      // Loaded when needed: the lyrics store pulls in the player (and its audio elements).
      void import("../lyrics/store").then((m) => m.clearLyricsCache()).catch(() => {});
      break;
    case "repairYearRecaps":
      // 2.5.0 could freeze an early-unlocked year from the local log alone: such recaps are made again.
      void import("../recap/store").then((m) => m.repairThinYearRecaps()).catch(() => {});
      break;
  }
}

/**
 * Startup (after the first-run check): after an update to a version with an entry, shows it once (a moment in,
 * after the first page). On a fresh install it only saves the version.
 */
let started = false;
export function initWhatsNew(freshInstall: boolean) {
  if (started) return;
  started = true;
  getVersion().then((version) => {
    const { show, save } = pickWhatsNew(version, useSettings.getState().lastSeenVersion, freshInstall, WHATS_NEW);
    if (save) useSettings.getState().set({ lastSeenVersion: save });
    if (show) window.setTimeout(() => {
      show.onShow?.forEach(runChore);
      useWhatsNew.getState().show(show);
    }, 1200);
  }, () => {});
}
