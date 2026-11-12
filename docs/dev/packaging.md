# Packaging

Where each Sonolith package is defined, and what a distro package needs from the app.

| Package | Where | Built by |
| --- | --- | --- |
| AUR `sonolith` (from source) and `sonolith-bin` (from the release `.deb`) | `packaging/aur/` | The AUR user's helper; `scripts/aur.sh` fills the checksums and pushes. `ytdesk` and `ytdesk-bin` are transitional packages from before the rename. |
| Arch package attached to GitHub releases | `packaging/arch-bin/` (`packaging/arch/` builds from source) | `scripts/release.sh` |
| Debian / Ubuntu `.deb` | Tauri's deb bundler (`src-tauri/tauri.linux.conf.json`) | `scripts/release.sh` and CI (`npx tauri build --bundles deb`) |
| Windows installer (NSIS) | `src-tauri/windows/` | `scripts/release.sh` and CI |
| Void Linux (xbps-src template, x86_64 glibc) | `packaging/void/` | Not yet in void-packages; see [`packaging/void/README.md`](../../packaging/void/README.md) |

## Shared files

Every Linux package installs the same files; don't copy them into a packaging directory:

- `packaging/linux/sonolith.desktop`: the desktop entry (also the deb's `desktopTemplate`). `Icon=sonolith` and
  `StartupWMClass=sonolith` match the binary name, which is also the Wayland app_id.
- `src-tauri/icons/`: `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png` (256 px) and `icon.png` (512 px),
  installed as `sonolith.png` under `/usr/share/icons/hicolor/<size>/apps/`; `src-tauri/app-icon.svg` goes to
  `scalable/apps/sonolith.svg`.
- `LICENSE` (MIT).

## Building without the Tauri CLI

`npx tauri build --no-bundle` (what the AUR source package runs) builds the frontend and passes the
`tauri/custom-protocol` feature. A distro build system that runs cargo itself does the same in two steps:

```sh
npm ci && npm run build                                   # writes dist/, embedded at compile time
cd src-tauri && cargo build --release --locked --features tauri/custom-protocol,system-ytdlp
```

Without `tauri/custom-protocol` the binary loads the dev server URL and shows a blank window.

## What distro packages should enable

- **`--features system-ytdlp`**: yt-dlp comes from the distro package (`PATH`, or a path the user sets in
  Settings). Sonolith then never downloads or self-updates its own copy, and Settings says to use the package
  manager. Default builds keep the managed copy. yt-dlp also needs a JavaScript runtime (deno, node or bun) for
  YouTube; make one a dependency.
- **Install-source detection** (`src-tauri/src/update.rs`): the update dialog shows the right command instead of
  "Open GitHub" when `pacman -Qqo` (AUR packages) or `xbps-query -o` (the `sonolith` xbps package) owns the
  running binary. A new package manager gets the same treatment: a pure parser of the query output with tests, and
  a dialog section in `src/components/UpdateDialog.tsx`.

## Runtime dependencies that the library scan misses

- The tray icon loads `libayatana-appindicator3.so.1` with `dlopen` (falling back to `libappindicator3`): list it
  as a dependency explicitly.
- GStreamer plugins for audio (good + libav; WebKitGTK pulls in base).
- A Secret Service provider (gnome-keyring, KeePassXC, …) on a running D-Bus session bus stores the sign-in cookie;
  without one, sign-in shows a clear error. MPRIS also needs the session bus.

## Possible follow-up

A CI job that runs `xlint` on the Void template is cheap and offline. Building the Void package in CI is not: it
needs the Void container, a full Rust and WebKitGTK build and network access for crates and npm packages.
