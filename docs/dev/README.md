# Sonolith developer docs

Sonolith is a desktop YouTube Music client: **Tauri 2** (Rust backend in `src-tauri/`) + **React 19 / TypeScript /
Vite / Tailwind v4** (frontend in `src/`), state in **zustand**, music data from YouTube's InnerTube API through
**youtubei.js** plus our own raw calls. It targets **Linux** (WebKitGTK webview, the main platform) and **Windows**
(WebView2). MIT licensed. Setup and the pull request process are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

| Doc | Read it when |
| --- | --- |
| [architecture.md](architecture.md) | Before touching code: where things live, how data and playback flow, the Rust modules. |
| [conventions.md](conventions.md) | Before writing code: style, patterns, theming tokens, animation and performance rules. |
| [workflows.md](workflows.md) | Verifying, running, debugging against live YouTube, the local API spec generator, testing. |
| [pitfalls.md](pitfalls.md) | Before debugging anything odd: known traps (WebKitGTK, YouTube behavior, youtubei.js, Tauri). |
| [m3-expressive.md](m3-expressive.md) | Working on the Material 3 style: springs, corners, type, component specs. |
| [api-manual-test.md](api-manual-test.md) | Checking the local API by hand in the running app (needs `socat`, `jq`, fish). |

The local API for other apps is specified in [`api/SPEC.md`](../../api/SPEC.md).

Quick facts:

- UI text, code comments, commit messages and docs are **English**.
- Verify every change with the four checks in [workflows.md](workflows.md#verify-before-every-commit-and-pull-request).
- Don't read or edit `node_modules/`, `target/` or lockfiles by hand.
