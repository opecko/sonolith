import type { LucideIcon } from "lucide-react";
import type { NowPlayingLayout, UiStyle } from "../theme/appearance";

/** What a "What's new" button may do: a closed set of safe in-app actions, never arbitrary code. */
export type WhatsNewAction =
  | { type: "openSettings"; section: "appearance" | "about" }
  | { type: "setStyle"; style: UiStyle }
  /** Sets the layout; `open` also opens Now Playing, `tryCard` shows the layout picker card at its top. */
  | { type: "setNowPlayingLayout"; layout: NowPlayingLayout; open?: boolean; tryCard?: boolean };

export interface WhatsNewEntry {
  /** The release this entry is for, "X.Y.Z". */
  version: string;
  title: string;
  highlights: { icon: LucideIcon; title: string; text: string }[];
  actions?: { label: string; action: WhatsNewAction }[];
}
