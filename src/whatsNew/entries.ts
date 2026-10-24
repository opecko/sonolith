import { Clapperboard, Keyboard, LayoutDashboard, LogIn, MicVocal, Palette, Podcast, Settings2, Sparkles, Terminal } from "lucide-react";
import type { WhatsNewEntry } from "./types";

/**
 * "What's new" entries, newest first. Only add one when the user asks for it for a release; a version without an
 * entry shows nothing after the update.
 */
export const WHATS_NEW: WhatsNewEntry[] = [
  {
    // The release that ships the rename; adjust the version when it's picked.
    version: "2.3.0",
    title: "ytdesk is now Sonolith",
    highlights: [
      {
        icon: Sparkles,
        title: "Same app, new name",
        text: "Everything you had is still here: your settings and colors, your sign-in, your queue, episode progress and lyrics.",
      },
      {
        icon: Terminal,
        title: "For power users",
        text: "The Wayland window class and app id are now sonolith (update your Hyprland window rules), the MPRIS player is sonolith (playerctl -p sonolith), and the command is sonolith.",
      },
    ],
    actions: [{ label: "Open Settings → About", action: { type: "openSettings", section: "about" } }],
  },
  {
    version: "2.2.0",
    title: "ytdesk 2.2: no account needed",
    highlights: [
      {
        icon: LogIn,
        title: "Use it without signing in",
        text: "Search, browse and play music without a Google account. Sign in only for your library, likes, playlists and history.",
      },
      {
        icon: Palette,
        title: "Now Playing in its cover's colors",
        text: "Colors from album art can now theme just Now Playing and leave the rest of ytdesk in your palette.",
      },
      {
        icon: MicVocal,
        title: "Improvements to lyrics",
        text: "Instrumental breaks get breathing dots that swell into the next line, sung lines take a color of their own, and word-by-word lyrics are found for more songs.",
      },
      {
        icon: Settings2,
        title: "Clearer settings",
        text: "Settings are sorted into categories, each on its own page, and every option says what it does.",
      },
    ],
    actions: [
      { label: "Colors from album art", action: { type: "openSettings", section: "colors", focus: "coverColors" } },
      { label: "Explore the settings", action: { type: "openSettings", section: "look" } },
    ],
    // The lyrics cached by 2.1.0 include ones picked without the track's length: look them all up again.
    onShow: ["clearLyricsCache"],
  },
  {
    version: "2.1.0",
    title: "ytdesk 2.1: lyrics that sing along",
    highlights: [
      {
        icon: MicVocal,
        title: "Synced lyrics",
        text: "Lyrics follow the song line by line, word by word where available, from six providers. Pick a karaoke style and the providers' order in Settings → Lyrics.",
      },
      {
        icon: Podcast,
        title: "Better podcasts",
        text: "Episodes remember where you left off, the next episode plays when one ends, and searching for a podcast shows its shows and episodes first.",
      },
      {
        icon: Keyboard,
        title: "In-app keyboard shortcuts",
        text: "Only while the ytdesk window is focused, not system-wide: Space plays and pauses, < and > skip, + and - change the volume. Rebind or turn them off in Settings → Keyboard shortcuts.",
      },
    ],
    actions: [
      { label: "Choose a karaoke style", action: { type: "openSettings", section: "lyrics" } },
      { label: "Keyboard shortcuts", action: { type: "openSettings", section: "shortcuts" } },
    ],
  },
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
      { label: "Appearance settings", action: { type: "openSettings", section: "look" } },
      { label: "Prefer the old look? Switch to Classic", action: { type: "setStyle", style: "classic" } },
    ],
  },
];
