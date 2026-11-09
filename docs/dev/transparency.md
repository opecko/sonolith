# Transparent window (Linux)

Settings → Look → **Window** (Linux only; hidden on Windows, where nothing changed). Sonolith draws translucent
surfaces in a window with real alpha; **blur is the compositor's job**. The app never uses `backdrop-filter` or blur
filters (WebKitGTK renders them in software and they flicker; see pitfalls.md).

## How it works

- **The window** (`src-tauri/src/window.rs`). tauri.conf.json declares the main window with `"create": false`;
  `window::create_main` builds it first thing in `setup` from that entry. On Linux `.transparent(true)` makes tao
  give the GTK window an RGBA visual and `app_paintable`, and wry give the WebKit view a transparent background.
  The visual can only be chosen before the window is realized, so **the switch needs a restart**: it's stored in
  `config.json` (`transparent_window`, next to `gpu_rendering`), read at startup, and Settings shows "Restart
  Sonolith" (`app_restart`) when the stored value differs from what the window was created with.
  Under `tauri dev` that restart ends the dev command, and with it Vite: the new process shows no page. Close it
  and run `tauri dev` again (release builds restart normally).
- **No compositor** (an X11 session without a compositing manager): an RGBA window would be black where it's
  transparent. `window.rs` asks GDK (`gdk_screen_is_composited`) and keeps the window opaque then; Settings says
  why. Wayland always composites.
- **Frame, corners, shadow**: unchanged. Server-side decorations (KWin, Hyprland has none) don't depend on the
  visual; GTK's client-side decorations (GNOME) are drawn by GTK into the same RGBA window; not checked on GNOME. The window still drags,
  resizes, maximizes and tiles the same way: only the visual differs.
- **The surfaces** (`src/theme/glass.ts`, wired in `theme/index.ts`). When the window is transparent
  (`stores/windowGlass.ts` asks `window_info` once at startup and sets `data-glass` on `<html>`), `applyTheme` and
  `applyScopedTheme` write the surface tokens (`bg`, `surface`, `surface-2`, `surface-3`) with the "Surface opacity"
  alpha (`appearance.windowOpacity`, 30–100 %, default 85 %) and `-float` variants at least 92 %. The M3 roles are
  `color-mix()` recipes of those tokens, so containers, bars and cards follow. Text, icons, accents, album art and
  canvases (ambient light, visualizer, Recaps) keep their own colors. Menus, dialogs, tooltips, list boxes and
  `[data-float]` elements swap in the `-float` tokens and re-derive the roles (m3.css). "Colors from album art"
  goes through the same functions, so it keeps working, on the whole app or on Now Playing alone.
- **Startup screen** (`index.html`, `src/theme/splash.css`, `src/theme/splash.ts`): `#root` holds a logo screen until
  React's first render replaces it. Its colors are the palette's background and text saved by the last run
  (localStorage `splash`). A transparent window gets `window.__sonolithGlass` from an initialization script, so the
  inline script in `index.html` sets `data-glass` on `<html>` before any stylesheet paints and applies the saved
  surface opacity. Rust keeps the same background in `config.json` (`splash`, sent by `window_set_splash`): the window
  shows as soon as the webview exists, painted that color by WebKit's own background
  (`webkit_web_view_set_background_color`; tao's background for transparent windows passes 0–255 channels to cairo
  unscaled and comes out white), about a second before the page loads. Once the screen is parsed (`window_show`,
  with the page's load as the fallback) that color goes, or it would sit under the app's translucent surfaces.
  Without a saved color the window stays hidden until then, so it never appears as an empty, fully transparent
  frame.
- **Contrast warnings** (color editor) assume an opaque background; the setting's description says so.
- **No per-frame work** is added: the tokens are rewritten only when the theme, the cover colors or the opacity
  change.
- Dev toolkit → Look → **Checkerboard behind window** paints a checkerboard on `<html>`, under the body, to see the
  alpha without a busy desktop behind the window (dev builds only, `src/dev/checker.ts`).

## Blur per compositor

Settings → Look → Window → **Blur help** picks a hint from `XDG_SESSION_TYPE`, `XDG_CURRENT_DESKTOP` and
`HYPRLAND_INSTANCE_SIGNATURE` (`src/theme/blurHelp.ts`). The window class is `sonolith`.

### Hyprland (0.57; the Lua config)

Checked against the wiki for 0.57.0 (https://wiki.hypr.land/0.57.0/configuring/core/config-options/, section
Decoration → Blur, and https://wiki.hypr.land/0.57.0/configuring/core/rules/window-rules/). From 0.57 the wiki
documents only the Lua config; older releases used hyprlang (`decoration { blur { enabled = true } }`,
`windowrulev2 = noblur, class:^(sonolith)$`), which these pages no longer show.

`decoration.blur.enabled` is on by default (kawase blur); `size` and `passes` must be at least 1.

```lua
hl.config({ ["decoration.blur.enabled"] = true })

-- Optional: Sonolith transparent but not blurred
hl.window_rule({ match = { class = "sonolith" }, no_blur = true })
```

`popups` (blur behind popups) is off by default; Sonolith's menus are drawn inside its own window, so it doesn't
matter here. The wiki doesn't say whether blur follows the alpha of a
window's content (`ignore_opacity`, default on, is about opacity rules); check it on a real Hyprland session.

### KDE Plasma

The Blur effect (System Settings → Window Management → Desktop Effects) blurs only windows that request it (the KDE
blur protocol); GTK has no API for it, so Sonolith is transparent without blur. A third-party KWin effect that
forces blur by window class can add it.

### GNOME

No blur behind windows: transparent only.

### Others

Generic hint: the compositor's own blur or transparency settings, class `sonolith`.

## Measuring the cost

`scripts/measure-frame-cost.py [seconds] [compositor-process]` prints the CPU (% of a core) and GPU time (DRM
engine time from `/proc/<pid>/fdinfo`, i915 / xe / amdgpu) of `sonolith` and its WebKit processes, and of the
compositor if its process name is given. Compare a playing song with Now Playing open (the wavy seek bar running)
with the switch off and on.

Measured 2026-11-08 on an i5-7200U (HD Graphics 620), a debug build (`tauri dev`), a 1876×1002 window on a
wlroots compositor with blur on, a song playing, 3 × 30 s with Now Playing open (Material, ambient light on) and
30 s with it closed (Home page):

| | Sonolith CPU | Sonolith GPU | Compositor CPU | Compositor GPU |
| --- | --- | --- | --- | --- |
| Opaque, Now Playing open | 36 % | 18–20 % | 5 % | 20 % |
| Transparent, Now Playing open | 42–43 % | 20 % | 6.4 % | 26 % |
| Opaque, Home | 20 % | 8 % | 4.9 % | 21 % |
| Transparent, Home | 22.5 % | 14 % | 4.7 % | 35 % |

Transparency costs WebKit about 6 points of a core with Now Playing open and the compositor 6–14 points of GPU:
it re-blurs what's behind the window whenever the window repaints (the wavy seek bar repaints every frame). On a
weak GPU, turn blur off for the window (Hyprland: `no_blur`) or keep the switch off.
