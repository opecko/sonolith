# Pitfalls (learned the hard way)

Known traps in this codebase and its dependencies. Check here before debugging anything odd, and add to it when you
find a new one.

## WebKitGTK (Linux webview)

- **Stuck pixels after a border-radius change**: antialiased corner pixels at fractional positions fall outside the
  pixel-snapped border box, and WebKit only invalidates that box, so old edge pixels stay (seen in the 2px gaps of
  connected button groups). Morphing elements carry a transparent 1px outline, which widens the repaint rect.

- **Play/pause state must follow the `<audio>` element, not the store.** Pause/play/seek events can arrive late or
  out of order; a toggle that trusted `status` got stuck on "paused" over a playing element (play() on a playing
  element is a no-op and fires nothing), with only a track change fixing it. `stores/playState.ts`: toggles decide by
  `audio.paused`, every playback event reconciles the status, and time moving on a paused element reloads the source.
- **Push/slide panels: animate the layout, not transforms.** Translating the content and committing the final layout
  at the end snaps anything not centered (right-anchored close button, volume) by the difference. Material's side
  panel springs its own width in the flex row (content inside at full width, anchored left), so every frame is a
  real layout and the last one is the final layout (`nowplaying/pushPanel.ts`, unit-tested with rapid toggles).
- **CSS transform/opacity animations flash at the end**: one frame of the pre-animation state (Now Playing slide,
  ambient fade, switch knob all did it). CSS fixes (fill-mode, will-change, resting end-state) don't help. Use rAF or
  layout properties. The built-in Chromium browser can't reproduce it — only the real app.
- **It exports its own MPRIS player** for any playing `<audio>` (titled after the page, no metadata), and desktop
  shells (bars, media widgets) pick it over ours. Disabling the `MediaSession` feature doesn't stop it; giving
  `navigator.mediaSession` an **empty title** does (it only registers with a non-empty title).
- `content-visibility` misbehaves; lazy images can miss load events (Thumb doesn't gate on load state).
- Generic `font-family: monospace` alone shrinks text; use `ui-monospace, monospace`.
- No save dialog: export via copyable text, import via paste or `<input type=file>`.
- Repaints are expensive in software rendering: avoid timers that repaint, hide content under full overlays.

## Layout / CSS

- `border-radius` with a 9999px "full" corner next to a small one: the browser scales every corner of that side
  down to fit, so the small ones turn square. Clamp full corners to half the height (`min(full, --pill)`, shape
  vars are registered `<length>`s).
- Starting a JS animation one frame late after a state change paints the stylesheet's new state once (morph
  jumped at press start): write the start value synchronously.
- `@material/material-color-utilities` 0.4 has extensionless relative ESM imports: fine in Vite/tsx, Node can't
  load it, so vitest inlines it (`vite.config.ts` `test.server.deps.inline`).

- A `<canvas>` (replaced element) with only `left/right: 0` keeps its intrinsic width; give it `width: 100%`.
- Flex rows with non-shrinking chips (top bar): give the chip group `shrink-0` and the flexible part `min-w-0`, or
  the row overflows and the whole page scrolls sideways.
- Custom properties inherit: per-element ones (`--r`, `--ct`, `--sl`) are registered `inherits: false`.

## React / Vite dev

- **StrictMode runs effects twice in dev**: init functions with listeners need a module-level guard, or everything
  happens twice (MPRIS relative seeks jumped double).
- HMR keeps old module instances' listeners alive; restart `tauri dev` to test init code.
- **`useProgress.position` is frozen while the window is hidden** (perf). Anything that must be right with the window
  hidden (MPRIS position, bookkeeping) reads `playbackTime()` / `onPlaybackTick()` instead — MPRIS once reported 0:00
  on play/pause/volume from the panel after a track change in the background.
- A zustand selector returning a fresh array/object (even through `useShallow` with a `slice()` inside) → "Maximum
  update depth exceeded" and a blank window.
- Rolldown/Vite drops `if (import.meta.env.DEV) import("./dev")` from release builds; a static import anywhere would
  bundle it.

## YouTube / InnerTube

- **Origin must match the host** (music.youtube.com vs www.youtube.com) or requests fail (400) or come back
  anonymous. `makeYtFetch` handles it; mobile clients (VISIONOS) need an explicit youtube.com Origin.
- Non-Premium accounts get YTMUSIC streams that stop after ~1 MB → VISIONOS fallback (complete streams, no cookies).
- **The library listing lags behind edits**: new playlists appear late, deleted ones linger, track counts update
  late. A just-created playlist's page comes back without a title for a while. Use optimistic UI + reloads.
- Own vs saved playlists: YouTube doesn't flag ownership in the library. Own playlists' subtitle is just a count
  ("7 tracks"); saved ones show "Author • N tracks"; auto playlists a label ("Auto playlist", "YouTube Music").
  IDs `LM` (Liked Music), `RD…` (mixes), `SE` (Episodes for later) aren't editable.
- Chips exist only on radio queues; `/next` on bare videos/albums carries an automix seed instead.

## youtubei.js

- `playlist.delete()` is broken ("Expected an api_url"): call `exec("/playlist/delete", { playlistId })`.
- `playlist.removeVideos()` works for the user's own playlists ("This playlist cannot be edited." otherwise).
- Check `node_modules/youtubei.js/dist/src/...` for the real API before using a method.

## Rust / Tauri

- **Tray on Linux** (Tauri's tray-icon uses the AppIndicator backend): no icon click events at all, the tooltip is
  ignored, `set_title` only sets the label next to the icon, and the SNI `Id` is "tray-icon tray app <tray id>".
  Sonolith sets the AppIndicator `Title` through `tray-icon`'s `app_indicator()` (tray.rs) so hosts show "Sonolith".
  tray-icon's `ksni` backend would deliver left clicks and proper Id/Title, but Tauri hard-enables
  `libappindicator`; switching means forcing the feature (tray-icon picks ksni when both are on) — untested.

- Sync `#[tauri::command]` runs on the GTK main thread: anything blocking must be `async` or `spawn_blocking`.
- `cargo check` right after editing may print a stale "Finished" from a previous run if output was filtered — read
  the actual warnings/errors.

## Podcasts

- **Podcast episodes are not songs.** Search rows link the title to an episode page (`MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE`)
  and carry no video type; the byline is "Episode • date • Show". Detect by that link, a PODCAST video type or a
  show link (`raw.ts asEpisode`), never by the "Episode" label (localized). Episodes never start a radio.
- Fixtures from live responses: trim item lists but never `runs` (the show link is the last run).

## Text selection in WebKitGTK needs `-webkit-user-select`
WebKitGTK ignores the unprefixed `user-select`, so a plain `user-select: none` leaves the whole app selectable (a seek
bar drag or double-click selects text around it). The body rule sets both; Tailwind's `select-none` / `select-text`
emit both. App chrome is unselectable by default, readable text (lyrics, descriptions, Settings, dialogs, errors)
opts in with `select-text`; controls (buttons, sliders, switches, tabs, menu items) stay unselectable inside it.
Sliders also `preventDefault()` on pointerdown (and focus themselves), so a drag that leaves them selects nothing.
- **Canvas animation is expensive in WebKitGTK**: a 20 fps canvas wave cost ~30 % CPU. The wavy seek bar is a
  static SVG slid by an endless CSS transform animation on its own layer (compositor, off the main thread); endless
  animations never end, so the end-of-animation flash doesn't apply — pause them with `animation-play-state`.
  Never scale an SVG group to exactly 0 (singular transform, the stroke vanishes); use a tiny scale.
- The wave's cut ends get round caps: small dots on their own endless bob animation (eased alternate ≈ sine), kept
  in step with the wave by setting their `getAnimations()[0].currentTime` from the wave animation's on each render.
  While the wave's height springs (play / pause) the caps are held and posed every frame from the spring instead.

## First run

- **Startup writes look like an earlier install.** `ytdlp::ensure_fresh` creates `app_data_dir/bin` within
  milliseconds of setup, so the onboarding's "prior data on disk" check must not look at the disk when asked: it
  is snapshotted in setup before `ensure_fresh` (`render::PriorData`). Anything new that marks an existing install
  needs the same care (onboarding never showed on fresh Windows and Linux installs in 2.1.0).

## Window size

- **Hyprland (tiling) ignores the window's minimum size and scales the surface into the tile**, so a tile narrower
  than `minWidth` (`tauri.conf.json`) shows the whole UI horizontally squashed. Keep `minWidth` low (480) and the
  layout usable down to it: the sidebar is a rail below `lg`, the player bar drops ratings / ⋮ / volume slider below
  `md` and shuffle / repeat below `sm` (all in Now Playing).

## Identifier change (ytdesk → Sonolith)

- **Tauri creates the windows from `tauri.conf.json` before the app's `setup` closure runs**, and with them the
  webview data dir. Anything that must happen before the webview (the data migration, `migrate.rs`) runs in `run()`
  before `tauri::Builder`, with paths from `dirs` (= Tauri's `app_*_dir` = base dir / identifier).
- The webview origin (`tauri://localhost`, Windows `http://tauri.localhost`) doesn't contain the identifier, so a
  copied profile's localStorage is read as is.
- The bundler names the deb, its `.desktop` file and the NSIS installer after `productName`. Linux overrides it to
  `sonolith` (`tauri.linux.conf.json`) so the desktop file matches the app id; the Windows product stays "Sonolith".

## Local API

- **End of input is not a hang-up.** A shell pipe (`socat`) half-closes its side and still waits for
  `registration.resolved`, so EOF alone must not cancel a pending consent; only POLLHUP (both directions closed)
  does (`transport.rs` `hangup`). Named pipes cannot half-close: there EOF means gone.
- Denials and cooldowns apply to the app id **or** the identity key, so a test (or a buggy app) that changes its
  `appId` after a denial is still held back; tests that need a second app act as another program (`as_program`).
- The published player state carries ratings and episode progress; the server nulls them for apps without
  `library:read` (`for_scopes` in server.rs) — new events with an item need the same.
- **Lock order: registry, then conns.** `hello` authenticates the connection while holding the registry lock, and
  remove / block / replace change the registry before revoking; reversing either lets a session slip past a removal.
  Never take the registry lock while holding `conns`.
- `close()` is graceful (queued behind unsent data); a client that stops reading never lets it through. Anything that
  must end a connection now uses the kill switch (`abort`, backlog overflow); writes also time out after 10 s.
- **Own playlist ≠ entries with `setVideoId`**: editorial playlists carry entry ids too. Ownership is YouTube's
  editable header (`musicEditablePlaylistDetailHeaderRenderer`, privacy inside) → `BrowsePage.own`. Ids may come with
  the `VL` prefix (`VLLM` is liked songs): normalize before any check (`playlistId` in dispatch.ts).
- Identity derivation (/proc, `canonicalize` on paths from argv) is blocking and can hang: it runs via
  `spawn_blocking` with a 2 s timeout and 8 slots (`Server::identify`), never in the accept loop.
- **Windows drops toasts silently when the AppUserModelID is unknown.** The NSIS installer sets it only on the Start
  menu shortcut it creates on a fresh install (updates create none), so `notify.rs` also registers the id under
  `HKCU\Software\Classes\AppUserModelId\<identifier>` before the first toast. Failures go to `api.log` in the app's
  log directory (a release build has no console).
- Consent answers are ignored for 1 s after the request on screen changes (`CONSENT_ARM_MS`, store.ts); tests of the
  dialog flow need fake timers.
