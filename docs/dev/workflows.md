# Workflows

Everyday tasks: verify, run, debug against live YouTube, work on the local API spec. All commands run from the repo
root unless noted. Setup is in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Verify (before every commit and pull request)

```
npx tsc --noEmit                        # type check
npx vitest run                          # frontend unit tests, a few seconds
(cd src-tauri && cargo check)           # Rust compiles, no warnings
python3 api/tools/generate.py --check   # API spec is generated and its examples are valid
```

This is exactly what CI runs (`.github/workflows/checks.yml`). The last step needs the pinned Python packages:
`pip install -r api/tools/requirements.txt` (a virtualenv is fine). Also worth running when you touch Rust:
`cd src-tauri && cargo test`. On Linux you can check the Windows build with `cargo xwin check --target
x86_64-pc-windows-msvc` in `src-tauri/` (optional; needs `cargo install cargo-xwin`).

## Run the app

```
npm run tauri dev
```

Vite serves the frontend with hot reload; Rust edits rebuild and restart the app. The first Rust build takes a while.
Hot reload keeps old module-level listeners alive, so when behavior looks doubled after an edit (init code, event
listeners), restart. If port 1420 is busy, a previous `tauri dev` is still running. Closing the window ends
`tauri dev` with exit code 0, which is not a crash.

Useful live checks on Linux: `playerctl -p sonolith status|metadata|position`, `busctl --user list | grep -i mpris`.

## Dev toolkit

`npm run tauri dev` shows a **Dev build** chip in the top bar: simulate an update (marked `simulated`, never
downloads or opens anything), show any What's new entry, reset `lastSeenVersion`, preview the onboarding or simulate
a fresh install (clears the onboarding and version flags and sets the one-shot `dev:simulateFresh` marker so the real
first-run check sees no prior data on reload; settings stay), toggle style / layout / animations, edit the settings
JSON. A real fresh install: delete the app's webview data dir and the keyring entry.

The toolkit must never ship: `src/dev/` is loaded only through a dynamic import behind `import.meta.env.DEV` in
`main.tsx`, and nothing else may import it. `src/dev/isolation.test.ts` (part of vitest) and
`scripts/check-dev-isolation.sh` (builds the frontend into a temp dir and greps for the dev markers) enforce it.

## Checking views without the app (browser harness)

The webview needs Tauri, but a Vite dev server with a mocked Tauri IPC works in a normal browser for layout checks:
put a Vite config and the mock outside the repo, use `mockIPC` from `@tauri-apps/api/mocks` injected through
`transformIndexHtml`, answer `ytdlp_stream_url` with a blob URL of a silent WAV (playback works), make
`plugin:http|fetch` throw (offline), and seed `localStorage` (`queue-v1`, optionally a fake cookie for the signed-in
shell). Notes:

- A config outside the repo must import `vite` and the plugins by absolute paths into the project's `node_modules`.
- Chromium is not WebKitGTK: the animation flash bugs described in [pitfalls.md](pitfalls.md) never show there.
- To test a window size, load the app in a fixed-size same-origin `<iframe>`; media queries follow the iframe.
- A hidden browser tab gets no rendering steps (no `requestAnimationFrame`, no `ResizeObserver`), so replace rAF
  with a 16 ms timer in the mock when measuring.

## Debug against live YouTube

- Cookie for scripts: the `YTM_COOKIE` environment variable or `YTM_COOKIE=...` in `.env.local` (gitignored; see
  CONTRIBUTING.md for how to get one). `YTM_AUTHUSER=n` selects a brand account, `YTM_ANON=1` acts as an anonymous
  (non-Premium) client.
- `npm run dbg -- <cmd> [arg]` (`scripts/dbg.ts`): `home`, `library <tab>`, `search <q>`, `suggest <q>`, `browse`,
  `chips`, `radio`, `autoplay`, `tabs`, `stream <id>`, `clients`, `codecs`, `visionos`, … It writes **shape
  summaries** (`scripts/shape.ts`) to `debug/<name>.json`, never full payloads or the cookie.
- `scripts/dbgStream.ts`: playback resolution diagnostics (also writes `debug/ytdlp.log`).
- For a one-off question, write a read-only script outside the repo that imports `src/api/innertube.ts` and run it
  with `npx tsx file.mts` (`.mts` for top-level await). **Keep such scripts read-only**: don't create or delete
  anything on an account you care about.
- App-side playback failures are logged by the `log_playback` command to `debug/playback.log` in the repo root in dev
  builds (and to the app's log directory in release builds).

## Local API spec (`api/`)

`api/` is the public spec of the local API for other apps (`SPEC.md`, `openrpc.json`, `schema/`, `llms.txt`,
`examples/`, `CHANGELOG.md`). Data types live in `api/schema/*.schema.json`; methods, events, errors, scopes and rate
classes in `api/tools/generate.py`. **Never edit the generated blocks** of `SPEC.md`, `llms.txt`, `openrpc.json` or
`src/localApi/schema.gen.ts` by hand: run `python3 api/tools/generate.py`, then `python3 api/tools/generate.py
--check`, which validates every example against the schemas and every in-page link. Spec changes also go into
`api/CHANGELOG.md`.

Testing the API implementation:

- `cd src-tauri && cargo test --lib api::` runs the unit tests and the integration tests in
  `src-tauri/src/api/tests.rs` (a real server on a Unix socket in a temp dir, real clients, a fake host that answers
  consent and the bridge). `src/localApi/dispatch.test.ts` covers the frontend dispatcher with fake stores.
- Example clients against the real server code, no app needed: `SONOLITH_TEST_DIR=/tmp/snl cargo test --lib
  api::tests::live_server_for_examples -- --ignored --nocapture` in `src-tauri/` serves with a fake frontend that
  auto-approves consent (`SONOLITH_TEST_CONSENT=deny` denies; `touch /tmp/snl/remove` removes all apps, `touch
  /tmp/snl/stop` ends it). Run a client with `XDG_RUNTIME_DIR=/tmp/snl XDG_CONFIG_HOME=/tmp/snl/cfg`. Keep the path
  short: the AF_UNIX limit is 108 bytes.
- The reference client `api/examples/python-tui/` (standard library only) has its own tests: `python3 -m unittest`
  in that folder (a fake server in Python; never a real account). It also runs against the live test server above.
- Things only the running app can show (account writes, the real consent dialog, Settings):
  [api-manual-test.md](api-manual-test.md).

## Testing approach

- Logic lives in small pure modules with a `*.test.ts` next to them (vitest); fixtures are trimmed real responses in
  `__fixtures__/`. Parsers get a fixture test for every shape they handle and for shapes they must skip.
- Rust has unit tests in the module and integration tests for the API server (`cargo test`).
- UI is checked by hand in the running app, in **both** styles (M3 and Classic), dark and light, and in every Now
  Playing layout when the change touches it.
