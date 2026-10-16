import { Clapperboard, LayoutDashboard, Sparkles } from "lucide-react";
import type { WhatsNewEntry } from "./types";

/**
 * "What's new" entries, newest first. Only add one when the user asks for it for a release; a version without an
 * entry shows nothing after the update.
 */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "2.0.0",
    title: "ytdesk 2.0: a Material 3 Expressive redesign",
    highlights: [
      {
        icon: Sparkles,
        title: "A new look",
        text: "Material 3 Expressive throughout: tonal colors from your palette, springy animations and buttons that change shape as you press them.",
      },
      {
        icon: LayoutDashboard,
        title: "New Now Playing layouts",
        text: "Material and Bento, both with the queue built in, plus lyrics and related music a click away. The previous layout is still there as Classic.",
      },
      {
        icon: Clapperboard,
        title: "Animations switch",
        text: "Turn animations off in Settings → Appearance to reduce motion. By default it follows your system's setting.",
      },
    ],
    actions: [
      { label: "Try the new Now Playing", action: { type: "setNowPlayingLayout", layout: "material", open: true, tryCard: true } },
      { label: "Appearance settings", action: { type: "openSettings", section: "appearance" } },
      { label: "Prefer the old look? Switch to Classic", action: { type: "setStyle", style: "classic" } },
    ],
  },
];
