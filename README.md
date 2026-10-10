# ytdesk

vibe coded stuff btw

A fast, lightweight desktop app for **YouTube Music** on Windows and Linux.

Sign in with your Google account and you get your library, playlists, mixes and recommendations in an app of its
own. It's not a wrapped browser tab, so it starts quickly and uses little memory and CPU.

## Features

- **Your YouTube Music**: Home, Explore, Library (playlists, songs, albums, artists), search with suggestions and
  listening history, all synced with your account
- **Playback**: queue with drag-and-drop reordering, radio from any song, autoplay, mood/genre filters for mixes
- **Now Playing**: full-screen view with ambient colors from the cover, lyrics and related music
- **Likes, dislikes and playlists**: the ⋮ menu on every track works like on YouTube Music (play next, add to queue,
  save to playlist, go to artist/album…)
- **Podcasts**: show pages, playback speed, skip −10 s / +30 s, optional video
- **Appearance**: over 100 color palettes (dark and light), your own colors for every part of the UI, theme
  import/export, accent from the cover art, corner radius, compact density and interface size
- **Discord Rich Presence**: shows what you're listening to on your profile (can be turned off)
- **Desktop integration**: media keys, system tray, OS media controls with cover art
- Remembers your queue and position between restarts

## Download

Get the latest version from the [**Releases**](../../releases/latest) page:

| System | File | How to install |
| --- | --- | --- |
| **Windows 10 / 11** | `ytdesk_…_x64-setup.exe` | Double-click and follow the installer |
| **Ubuntu / Debian** (24.04+) | `ytdesk_…_amd64.deb` | Double-click, or `sudo apt install ./ytdesk_…_amd64.deb` |
| **Arch Linux** | `ytdesk-bin-…-x86_64.pkg.tar.zst` | `sudo pacman -U ytdesk-bin-…-x86_64.pkg.tar.zst` |

macOS isn't supported yet.

> **Windows says "Windows protected your PC"?** The installer isn't code-signed yet, so SmartScreen warns about it.
> Click **More info → Run anyway**.

## Getting started

1. Open **ytdesk** and click **Sign in**.
2. Log in to your Google account in the window that opens. ytdesk saves the session in your system's secure
   credential store (Windows Credential Manager / the Linux keyring), never in a plain file.
3. Play something. Click the cover in the bottom bar to open **Now Playing**.

**Tips**

- Closing the window keeps the music playing in the **tray**. Quit from the tray icon's menu, or turn this off in
  **Settings**.
- **Settings** also let you switch off Discord status or listening history, and turn off GPU rendering if you're
  gaming at the same time.

## Troubleshooting

- **A song won't play**: ytdesk retries automatically. If some songs still fail, open **Settings → Advanced** and
  install the **yt-dlp** fallback with one click.
- **Signed out unexpectedly**: YouTube sometimes expires sessions. Just sign in again.
- **Media keys don't work on Linux (Wayland)**: some Wayland desktops don't allow global shortcuts. Use your
  desktop's media controls instead; ytdesk shows up there too.
- **Linux: asked to unlock a keyring**, or sign-in isn't remembered: install and unlock a keyring service
  (e.g. GNOME Keyring or KWallet).

## Privacy

ytdesk talks only to YouTube / Google (and to Discord on your computer, if Rich Presence is on). There is no
analytics or telemetry, and no ytdesk server.

ytdesk is an unofficial app and isn't affiliated with or endorsed by Google or YouTube.

---

## For developers

Built with [Tauri 2](https://tauri.app) (Rust) + React + TypeScript. Music data comes from YouTube's InnerTube API
via [youtubei.js](https://github.com/LuanRT/YouTube.js).

### Prerequisites

- [Node.js](https://nodejs.org) 20+ and [Rust](https://rustup.rs) (stable)
- **Windows**: Microsoft C++ Build Tools and WebView2 (preinstalled on Windows 10/11); see
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- **Linux**: `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libxdo-dev` (Debian/Ubuntu
  names) plus GStreamer plugins at runtime (`gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav`)

### Run and test

```
npm install
npm run tauri dev                 # run in development
npm test                          # unit tests
npx tsc --noEmit                  # type check
cd src-tauri && cargo test        # Rust tests
```

To skip the sign-in window during development, put your cookie in `YTM_COOKIE` (or a git-ignored `.env.local`);
it's used only when the keyring is empty.

### Build installers

- On any OS: `npm run tauri build` builds the installer for that OS in `src-tauri/target/release/bundle/`.
- All packages at once (Arch-based Linux host: Windows `.exe` via cross-compile, `.deb`, Arch package via makepkg):
  `scripts/release.sh`. Packages land in `release/<version>/` with `SHA256SUMS`.
  Bump the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json` and
  `packaging/arch*/PKGBUILD` first.
- **Actions → Release → Run workflow** builds everything on GitHub for an existing tag and attaches it to the
  release.

## License

[MIT](LICENSE)
