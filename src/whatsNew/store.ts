import { getVersion } from "@tauri-apps/api/app";
import { create } from "zustand";
import { openSettings } from "../stores/nav";
import { freshInstall, setAppearance, useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";
import { WHATS_NEW } from "./entries";
import { pickWhatsNew } from "./select";
import type { WhatsNewAction, WhatsNewEntry } from "./types";

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
      openSettings(a.section);
      break;
    case "setStyle":
      setAppearance({ uiStyle: a.style });
      break;
    case "setNowPlayingLayout":
      setAppearance({ nowPlayingLayout: a.layout });
      if (a.tryCard) useUi.getState().setTryLooks(true);
      if (a.open) useUi.getState().setNowPlaying(true);
      break;
  }
}

/** Startup: after an update to a version with an entry, shows it once (a moment in, after the first page). */
let started = false;
export function initWhatsNew() {
  if (started) return;
  started = true;
  getVersion().then((version) => {
    const { show, save } = pickWhatsNew(version, useSettings.getState().lastSeenVersion, freshInstall, WHATS_NEW);
    if (save) useSettings.getState().set({ lastSeenVersion: save });
    if (show) window.setTimeout(() => useWhatsNew.getState().show(show), 1200);
  }, () => {});
}
