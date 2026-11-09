// The phone remote as the UI sees it (src-tauri/src/remote/mod.rs `status`), and the app's colors sent to its page.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { effectiveTokens } from "../theme";
import { coverTokens } from "../stores/coverColors";
import { useSettings } from "../stores/settings";
import { remoteTheme } from "./theme";

export interface RemoteStatus {
  enabled: boolean;
  running: boolean;
  /** The pairing link while running (its secret pairs phones). */
  url: string | null;
  /** The link as a QR code (SVG markup built by Rust from the link only). */
  qrSvg: string | null;
  /** Running, but this computer has no network address to show. */
  noNetwork: boolean;
  paired: number;
  connected: number;
  error: string | null;
}

interface RemoteState {
  status: RemoteStatus | null;
  refresh: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  /** A new secret; every paired phone is unpaired. */
  newLink: () => Promise<void>;
}

export const useRemote = create<RemoteState>((set) => ({
  status: null,
  refresh: async () => set({ status: await invoke<RemoteStatus>("remote_status") }),
  setEnabled: async (enabled) => {
    try {
      set({ status: await invoke<RemoteStatus>("remote_set_enabled", { enabled }) });
    } catch {
      set({ status: await invoke<RemoteStatus>("remote_status") });
    }
    sendRemoteTheme();
  },
  newLink: async () => set({ status: await invoke<RemoteStatus>("remote_new_link") }),
}));

let lastTheme = "";

/** The current colors to the phone page, while the remote runs and when they changed. */
export function sendRemoteTheme() {
  if (!useRemote.getState().status?.running) return;
  const theme = remoteTheme(effectiveTokens(useSettings.getState().appearance, coverTokens()));
  const key = JSON.stringify(theme);
  if (key === lastTheme) return;
  lastTheme = key;
  void invoke("remote_theme", { tokens: theme.tokens, light: theme.light }).catch(() => (lastTheme = ""));
}
