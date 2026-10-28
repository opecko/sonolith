# Sonolith

vibe coded stuff btw

A fast, lightweight desktop app for **YouTube Music** on Windows and Linux.

It's not a wrapped browser tab, so it starts quickly and uses little memory and CPU. Browse, search and play without
an account; sign in with Google for your library, playlists, likes, mixes and history.

> **Sonolith was called ytdesk** until version 2.2. Updating keeps your settings, sign-in, queue and everything
> else. If you customized things around the old name: the command is now `sonolith`, the Wayland app id / window
> class is `sonolith` (update Hyprland window rules), and the MPRIS player is `sonolith` (`playerctl -p sonolith`).
> On Arch, `yay -Syu` moves `ytdesk-bin` / `ytdesk` over to `sonolith-bin` / `sonolith`.

## Features

- **Your YouTube Music**: Home, Explore, Library (playlists, songs, albums, artists), artist and album pages, search
  with suggestions and filters, listening history, all synced with your account
- **No account needed**: search, browse and play signed out; sign in only for your library, likes and playlists
- **Several accounts and channels**: switch between the Google accounts you're signed in with and your brand
  channels from the account menu
- **Playback**: queue with drag-and-drop reordering, radio from any song, autoplay, mood/genre filters for mixes,
  gapless playback and live stations; your queue and position survive a restart
- **Now Playing**: three layouts (Material, Bento and Classic) with the queue, lyrics and related music, colors
  from the cover art, a visualizer, a Song / Video switch for music videos and a Save to playlist button
- **Synced lyrics**: line by line, word by word where available, gathered from several sources; pick a karaoke style
  (Sweep, Glow, Bounce or Simple) and the order of the sources
- **Likes, dislikes and playlists**: the ⋮ menu on every track works like on YouTube Music (play next, add to queue,
  save to playlist, go to artist/album…); create, rename and delete playlists
- **Podcasts**: show pages, episodes remember where you left off, the next episode plays when one ends, playback
  speed, skip −10 s / +30 s, optional video
- **Appearance**: a Material 3 Expressive design (or the Classic look), over 100 color palettes (dark and light),
  your own colors for every part of the UI, theme import/export, colors from the album art for the whole app or just
  Now Playing, corner radius, compact density, interface size, fonts, and an animations switch
- **Keyboard shortcuts** in the window (rebindable) and global **media keys**
- **Desktop integration**: system tray, OS media controls with cover art (MPRIS on Linux, SMTC on Windows),
  **Discord Rich Presence** (can be turned off)
- **Connected apps**: widgets, bars and scripts can show what's playing and control Sonolith through a local API,
  only with your approval (off by default)

## Download

### Arch Linux and Arch-based distros (CachyOS, EndeavourOS, Manjaro…)

Install from the AUR with your AUR helper. Updates then come with your normal system upgrade (`yay` / `paru`).

```
yay -S sonolith-bin
```

or `paru -S sonolith-bin`. [`sonolith-bin`](https://aur.archlinux.org/packages/sonolith-bin) is the ready-built app;
[`sonolith`](https://aur.archlinux.org/packages/sonolith) builds it from source instead (takes a while).

### Windows and Ubuntu / Debian

Get the latest version from the [**Releases**](../../releases/latest) page:

| System | File | How to install |
| --- | --- | --- |
| **Windows 10 / 11** | `sonolith_…_x64-setup.exe` | Double-click and follow the installer |
| **Ubuntu / Debian** (24.04+) | `sonolith_…_amd64.deb` | Double-click, or `sudo apt install ./sonolith_…_amd64.deb` |

macOS isn't supported yet.

> **Windows says "Windows protected your PC"?** The installer isn't code-signed yet, so SmartScreen warns about it.
> Click **More info → Run anyway**.

## Getting started

1. Open **Sonolith**. A short setup at first start lets you pick the look and a few options; you can run it again
   from Settings → About.
2. Play something right away, or click **Sign in** and log in to your Google account in the window that opens.
   Sonolith saves the session in your system's secure credential store (Windows Credential Manager / the Linux
   keyring). On Linux it also keeps a copy only your user can read (`~/.config/dev.sonolith.app/sign-in`), so a
   missing or locked keyring doesn't sign you out.
3. Click the cover in the bottom bar to open **Now Playing**.

**Tips**

- Have more than one YouTube channel? Click your picture in the top right to switch between them.
- Closing the window keeps the music playing in the **tray**. Quit from the tray icon's menu, or turn this off in
  **Settings**.
- In the window, Space plays and pauses, `<` and `>` skip, `+` and `-` change the volume. Rebind them in
  **Settings → Keyboard shortcuts**.
- **Settings** also let you switch off Discord status or listening history, and turn off GPU rendering if you're
  gaming at the same time.

## Connected apps

Other programs on your computer (a media widget in your bar, a script, a terminal client) can show what's playing,
the lyrics, your queue and library, and control playback through Sonolith's local API. It is **off by default**:
turn on **Settings → Connected apps → Let other apps connect to Sonolith** (or in the setup at first start) if you
want to use such an app.

Nothing can connect without your approval. The first time an app asks, Sonolith shows what it wants to do; you allow
it, choose what it may do, say "Not now", or block it. Settings → Connected apps lists the apps you've allowed, lets
you take back single permissions, remove or block an app, and turn the whole thing off again. The API only listens
on your computer, never on the network.

Building such an app? See [For developers](#for-developers).

## Troubleshooting

- **A song won't play**: Sonolith retries automatically. If some songs still fail, open **Settings → System** and
  install the **yt-dlp** fallback with one click.
- **Signed out unexpectedly**: YouTube sometimes expires sessions. Just sign in again.
- **Media keys don't work on Linux (Wayland)**: some Wayland desktops don't allow global shortcuts. Use your
  desktop's media controls instead; Sonolith shows up there too.
- **Linux: asked to unlock a keyring**: Sonolith works without one too (see Getting started), but a keyring service
  (e.g. GNOME Keyring or KWallet) keeps the session in it.
- **Sign-in fails**: Sonolith says why, and writes it to its log: `~/.local/share/dev.sonolith.app/logs/playback.log`
  on Linux, `%LOCALAPPDATA%\dev.sonolith.app\logs\playback.log` on Windows. Include it when you report the problem.

## Privacy

Sonolith talks only to YouTube / Google (and to Discord on your computer, if Rich Presence is on). There is no
analytics or telemetry, and no Sonolith server. Your sign-in stays on your computer (see Getting started). Connected apps are local only, off by default, and each one needs
your approval.

Sonolith is an unofficial app and isn't affiliated with or endorsed by Google or YouTube.

---

## For developers

Built with [Tauri 2](https://tauri.app) (Rust) + React + TypeScript. Music data comes from YouTube's InnerTube API
via [youtubei.js](https://github.com/LuanRT/YouTube.js).

**Building an app for Sonolith?** The local API (version 1.0, stable; JSON-RPC over a Unix socket on Linux, a named
pipe on Windows) is specified in [`api/SPEC.md`](api/SPEC.md), also as [`api/openrpc.json`](api/openrpc.json) and
JSON Schemas, with a short summary for AI assistants in [`api/llms.txt`](api/llms.txt) and complete example clients
in Python, Node.js and shell in [`api/examples/`](api/examples/), including a terminal client that uses every
feature ([`api/examples/python-tui/`](api/examples/python-tui/)).

### Prerequisites

- [Node.js](https://nodejs.org) 20+ and [Rust](https://rustup.rs) (stable)
- **Windows**: Microsoft C++ Build Tools and WebView2 (preinstalled on Windows 10/11); see
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- **Linux**: `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libxdo-dev` (Debian/Ubuntu
  names) plus GStreamer plugins at runtime (`gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav`)

### Run and test

```
npm install
npm run tauri dev                      # run in development
```

Before a pull request, run the same checks as CI:

```
npx tsc --noEmit                       # type check
npx vitest run                         # unit tests
cd src-tauri && cargo check            # Rust (cargo test for its tests)
python3 api/tools/generate.py --check  # API spec is in sync (needs pip install jsonschema)
```

To skip the sign-in window during development, start the app with your cookie in the `YTM_COOKIE` environment
variable (used only when the keyring is empty); the debug scripts also read a git-ignored `.env.local`. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how to get one safely.

### Build installers

`npm run tauri build` builds the installer for your OS in `src-tauri/target/release/bundle/`.

## Contributing

Bug reports, ideas and pull requests are welcome, including ones made with an AI assistant. See
[CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions and the pull request process, and
[SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE). The Material 3 style uses [Google Sans Flex](https://github.com/googlefonts/googlesans-flex) by
Google, bundled under the [SIL Open Font License 1.1](src/assets/fonts/GoogleSansFlex-OFL.txt).
