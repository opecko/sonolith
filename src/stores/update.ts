import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { useSettings } from "./settings";

export interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  /** Release notes (Markdown) from GitHub. */
  notes: string;
  url: string;
  /** Windows build with an installer attached to the release. */
  installer: boolean;
  /** Installed from the AUR ("sonolith" / "sonolith-bin", or ytdesk / ytdesk-bin from before the rename), with the AUR helpers found (yay, paru). */
  aur: { package: string; helpers: string[] } | null;
  /** Made up by the dev toolkit to exercise this UI: nothing is downloaded, installed or opened. */
  simulated?: boolean;
}

type Install =
  | { status: "idle" }
  | { status: "downloading"; downloaded: number; total: number | null }
  | { status: "starting" }
  | { status: "error"; message: string };

interface UpdateState {
  /** Set when GitHub has a newer release than this build. */
  available: UpdateInfo | null;
  dialogOpen: boolean;
  install: Install;
  /** Asks GitHub; returns the result so Settings can say "you're up to date". */
  check: () => Promise<UpdateInfo>;
  setDialogOpen: (open: boolean) => void;
  installNow: () => Promise<void>;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useUpdate = create<UpdateState>((set, get) => ({
  available: null,
  dialogOpen: false,
  install: { status: "idle" },
  check: async () => {
    const info = await invoke<UpdateInfo>("update_check");
    set({ available: info.newer ? info : null });
    return info;
  },
  setDialogOpen: (dialogOpen) => set(dialogOpen ? { dialogOpen } : { dialogOpen, install: get().install.status === "error" ? { status: "idle" } : get().install }),
  installNow: async () => {
    const info = get().available;
    if (!info || get().install.status === "downloading" || get().install.status === "starting") return;
    if (info.simulated) {
      set({ install: { status: "error", message: "Simulated update: nothing was downloaded." } });
      return;
    }
    set({ install: { status: "downloading", downloaded: 0, total: null } });
    const unlisten = await listen<{ downloaded: number; total: number | null }>("update-progress", (e) =>
      set({ install: { status: "downloading", ...e.payload } }),
    );
    try {
      await invoke("update_install", { version: info.latest });
      set({ install: { status: "starting" } }); // Sonolith quits in a moment
    } catch (e) {
      set({ install: { status: "error", message: errorText(e) } });
    } finally {
      unlisten();
    }
  },
}));

/** Startup check (a few seconds in, so it doesn't compete with the first page load). Failures stay silent. */
let started = false;
export function initUpdates() {
  if (started || !useSettings.getState().updateCheck) return;
  started = true;
  window.setTimeout(() => void useUpdate.getState().check().catch(() => {}), 5000);
}
