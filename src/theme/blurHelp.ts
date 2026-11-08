// Settings → Look → Window → Blur help: Sonolith can't blur by itself, the compositor does. Which hint fits is
// picked from the session (window.rs reads the environment). Snippets: docs/dev/transparency.md.

export type Desktop = "hyprland" | "kde" | "gnome" | "other";

export interface Session {
  sessionType: string;
  desktop: string;
  hyprland: boolean;
}

/** $XDG_CURRENT_DESKTOP is a colon-separated list ("KDE", "ubuntu:GNOME", "Hyprland"). */
export function detectDesktop(s: Session): Desktop {
  const parts = s.desktop.toLowerCase().split(":").map((p) => p.trim());
  if (s.hyprland || parts.includes("hyprland")) return "hyprland";
  if (parts.includes("kde")) return "kde";
  if (parts.includes("gnome")) return "gnome";
  return "other";
}

export interface BlurHint {
  title: string;
  steps: string[];
  /** Config to paste, if the desktop has one. */
  snippet?: string;
}

/** The window class compositors see (tauri.conf.json mainBinaryName). */
export const WINDOW_CLASS = "sonolith";

export function blurHint(d: Desktop): BlurHint {
  switch (d) {
    case "hyprland":
      return {
        title: "Hyprland",
        steps: [
          "Hyprland blurs what's behind translucent windows when decoration.blur.enabled is on (it is by default).",
          `To keep Sonolith transparent but not blurred, add a window rule for the class "${WINDOW_CLASS}".`,
        ],
        snippet: `-- Hyprland 0.57+ (Lua config)\nhl.config({ ["decoration.blur.enabled"] = true })\n\n-- Optional: no blur behind Sonolith\nhl.window_rule({ match = { class = "${WINDOW_CLASS}" }, no_blur = true })`,
      };
    case "kde":
      return {
        title: "KDE Plasma",
        steps: [
          "Plasma's Blur effect (System Settings → Window Management → Desktop Effects) only blurs windows that ask for it, and Sonolith can't ask: it stays transparent without blur.",
          "A third-party KWin effect that forces blur by window class can add it; the class is \"sonolith\".",
        ],
      };
    case "gnome":
      return {
        title: "GNOME",
        steps: ["GNOME doesn't blur behind windows: Sonolith will be transparent, without blur."],
      };
    default:
      return {
        title: "Your desktop",
        steps: [
          "Blur behind windows is a setting of your compositor (the part of the desktop that draws windows), if it has one.",
          `Look for a blur or transparency option there; the window class is "${WINDOW_CLASS}".`,
        ],
      };
  }
}
