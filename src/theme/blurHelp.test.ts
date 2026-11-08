import { describe, expect, it } from "vitest";
import { blurHint, detectDesktop } from "./blurHelp";

const s = (desktop: string, hyprland = false, sessionType = "wayland") => ({ desktop, hyprland, sessionType });

describe("blur help", () => {
  it("picks the desktop from the session", () => {
    expect(detectDesktop(s("Hyprland"))).toBe("hyprland");
    expect(detectDesktop(s("", true))).toBe("hyprland");
    expect(detectDesktop(s("KDE"))).toBe("kde");
    expect(detectDesktop(s("ubuntu:GNOME"))).toBe("gnome");
    expect(detectDesktop(s("sway"))).toBe("other");
    expect(detectDesktop(s("", false, "x11"))).toBe("other");
  });

  it("only Hyprland gets a config snippet, with Sonolith's window class", () => {
    expect(blurHint("hyprland").snippet).toContain('class = "sonolith"');
    expect(blurHint("kde").snippet).toBeUndefined();
    expect(blurHint("gnome").steps.join(" ")).toMatch(/without blur/);
  });
});
