# Contributing to Sonolith

Thanks for helping! Sonolith is a Tauri 2 (Rust) + React / TypeScript desktop client for YouTube Music, for Linux and
Windows. Small, focused pull requests that follow the conventions below get reviewed and merged fastest. For anything
bigger than a bug fix, **open an issue first** so we can agree on the approach before you spend time on it.

## Setup

You need Node.js 22 (20+ works), Rust (stable, installed with [rustup](https://rustup.rs)), the system libraries
Tauri needs, and Python 3.10+ for the API spec check.

### Linux

Install the [Tauri prerequisites](https://tauri.app/start/prerequisites/#linux) for your distribution, plus D-Bus
headers (MPRIS) and `xdo`:

```sh
# Debian / Ubuntu (24.04+)
sudo apt install build-essential curl wget file patchelf libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libdbus-1-dev libxdo-dev
# at runtime you also need audio codecs:
sudo apt install gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav

# Arch
sudo pacman -S --needed base-devel curl wget file openssl webkit2gtk-4.1 libayatana-appindicator librsvg xdotool \
  dbus gst-plugins-good gst-plugins-bad gst-libav

# Fedora
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel \
  libxdo-devel dbus-devel gstreamer1-plugins-good gstreamer1-plugins-bad-free gstreamer1-libav
sudo dnf group install "c-development"
```

### Windows

Install [Node.js](https://nodejs.org), [rustup](https://rustup.rs) (default `x86_64-pc-windows-msvc` toolchain),
the **Microsoft C++ Build Tools** ("Desktop development with C++") and WebView2 (preinstalled on Windows 10/11).
Details: [Tauri prerequisites](https://tauri.app/start/prerequisites/#windows). Python from python.org (or the Store).

### Get the code and install dependencies

Fork the repository on GitHub, then:

```sh
git clone https://github.com/<you>/sonolith.git
cd sonolith
git remote add upstream https://github.com/opecko/sonolith.git

npm ci                                         # frontend dependencies, exactly as locked
python3 -m venv ~/.venvs/sonolith              # a virtualenv outside the repo, so it can't end up in a commit
. ~/.venvs/sonolith/bin/activate               # Windows: %USERPROFILE%\.venvs\sonolith\Scripts\activate
pip install -r api/tools/requirements.txt      # for the API spec check
```

### Run it

```sh
npm run tauri dev
```

The first build compiles all Rust dependencies and takes several minutes. Frontend edits hot-reload; Rust edits
rebuild and restart the app. Without signing in, browsing, search and playback work anonymously; Library and History
need an account.

### Optional: a YouTube cookie for the debug tools

To skip the sign-in window while developing, or to use the debug harness (`npm run dbg -- home`, see
[docs/dev/workflows.md](docs/dev/workflows.md#debug-against-live-youtube)), you can provide the cookie of a signed-in
YouTube Music session:

1. Prefer a **throwaway Google account**. The cookie is as powerful as your password until you sign out.
2. Sign in at <https://music.youtube.com> in a desktop browser, open DevTools → Network, reload, click any request
   to `music.youtube.com`, and copy the value of the `cookie` request header.
3. For the debug scripts, put it in `.env.local` in the repo root (one line, `YTM_COOKIE=<value>`). The file is
   gitignored. For the app itself, export it in the shell that starts it: `YTM_COOKIE='<value>' npm run tauri dev`
   (the app only uses it when the OS keyring has no cookie).
4. **Never commit it, paste it into an issue or a PR, or share logs without checking them.** To invalidate it, sign
   out of YouTube in that browser.

## Project tour

| Where | What |
| --- | --- |
| `src/` | Frontend: views, components, zustand stores, the YouTube API layer (`src/api/`), theme engine, motion engine |
| `src-tauri/src/` | Rust backend: keyring auth, stream proxy, yt-dlp, MPRIS, tray, Discord, updates, the local API server |
| `api/` | Public spec of the local API for other apps; the generator is `api/tools/generate.py` |
| `scripts/` | Debug harness and maintainer scripts (you don't need the release scripts) |
| `docs/dev/` | Developer docs, below |

Read these before changing code (they are short):

- [docs/dev/architecture.md](docs/dev/architecture.md): where things live, data and playback flow, Tauri commands.
- [docs/dev/conventions.md](docs/dev/conventions.md): code style, theming tokens, animation and performance rules.
- [docs/dev/workflows.md](docs/dev/workflows.md): verify, run, debug, the API generator, testing.
- [docs/dev/pitfalls.md](docs/dev/pitfalls.md): known traps. Check it before debugging anything odd.

## Conventions

The full list is in [docs/dev/conventions.md](docs/dev/conventions.md). The ones reviewers check first:

- **Colors only through tokens** (`var(--c-…)`, `var(--m3-…)`, token Tailwind classes such as `bg-fg/10`). No hex,
  `rgba()`, `bg-white` or `text-black` outside `src/index.css` and `src/theme/`.
- **Icons: `lucide-react` only.**
- **UI text is English, sentence case** ("Add to queue", not "Add To Queue").
- **Both styles (Material 3 and Classic) and all Now Playing layouts must keep working.** Classic must not change
  unless your change is about it. Check dark and light.
- **Respect the animations setting.** Use the helpers in `src/motion`; don't write ad-hoc animation loops. Avoid CSS
  `transform`/`opacity` animations for anything that must not flicker (WebKitGTK flashes at the end; see pitfalls).
- **Small pure modules with tests.** Put logic in a plain module with a `*.test.ts` (vitest) next to it; keep stores
  and components thin. YouTube response parsers never throw on unknown shapes.
- **Commit messages** read like the existing history (`git log --oneline`): one line, imperative-ish, `Area: what
  changed and why`, for example `Playlists: remove entries by their own entry id`. One logical change per commit.
- No new dependencies without discussing them first in the issue.

## Verify before you push

Run exactly what CI runs (`.github/workflows/checks.yml`) from the repo root:

```sh
npx tsc --noEmit
npx vitest run
(cd src-tauri && cargo check)
python3 api/tools/generate.py --check
```

Optional: `cd src-tauri && cargo test` when you change Rust, and `cargo xwin check --target x86_64-pc-windows-msvc`
in `src-tauri/` (needs [cargo-xwin](https://github.com/rust-cross/cargo-xwin)) to check the Windows build from Linux.
If you changed the API schemas or `generate.py`, run `python3 api/tools/generate.py` first and commit the
regenerated files.

## Pull requests

1. **Fork** the repository and create a branch from the up-to-date default branch (`master`) of `upstream`, named
   `fix/…`, `feat/…` or `docs/…`, for example `fix/queue-drag-flicker`.
2. Keep it **small and focused**: one problem per PR, no drive-by reformatting. **Rebase** on upstream before you
   open the PR (`git fetch upstream && git rebase upstream/master`) and when it falls behind; don't merge upstream
   into your branch.
3. Make sure the **verify step passes** locally; CI runs it on your PR.
4. Fill in the **pull request template**. Say what changed, why, and how you tested it.
5. For **UI changes**, attach screenshots or a short GIF in **Material 3 and Classic**, **dark and light**.
6. **Link the issue** (`Fixes #123`).
7. **Don't** bump versions, write release notes or "What's new" entries, or touch packaging (`packaging/`,
   `scripts/release.sh`, workflows) unless the maintainer asked for it. They do this when cutting a release.
8. By contributing you agree your work is licensed under the project's [MIT license](LICENSE).

**What to expect from review:** the maintainer reads PRs in their spare time, so replies can take a few days. Review
comments are about the conventions above and about keeping the app fast and small, not about taste. Push fixes as
new commits while review is running (or fixup commits); you may be asked to squash at the end. A PR that is
inactive for a few weeks may be closed; you can always reopen it.

Security issues: don't open a public issue. See [SECURITY.md](SECURITY.md).

## Working with AI assistants

AI-assisted contributions are welcome under the same bar as any other:

- The repository ships rules for assistants: [`AGENTS.md`](AGENTS.md) (read by most tools) and
  [`CLAUDE.md`](CLAUDE.md) (Claude Code, which imports `AGENTS.md`). They tell the assistant to read these docs, run
  the verify step and keep changes small. Point your tool at them.
- **You are responsible for every line you submit.** Read the diff, understand it and be able to explain it in review.
- AI-written code must pass the verify step and be tested the way a human change would be (in the running app for
  UI and playback changes). Say in the PR that an assistant helped and what you checked yourself.
- Don't let an assistant push, bump versions or add release notes (its rules forbid it; check).
- Personal assistant settings (your own preferences) go in gitignored files such as `CLAUDE.local.md`, never in
  `AGENTS.md` / `CLAUDE.md`.
