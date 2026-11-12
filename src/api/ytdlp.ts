import { invoke } from "@tauri-apps/api/core";

export interface YtdlpStatus {
  path: string;
  version: string | null;
  managed: boolean;
  configured: string | null;
  jsRuntime: string | null;
  /** Distro build: yt-dlp comes from the system packages, so Install and Update are unavailable. */
  system: boolean;
}

export const ytdlpStatus = () => invoke<YtdlpStatus>("ytdlp_status");
export const ytdlpInstall = () => invoke<string>("ytdlp_install");
export const ytdlpUpdate = () => invoke<string>("ytdlp_update");
export const ytdlpSetPath = (path: string | null) => invoke<void>("ytdlp_set_path", { path });
