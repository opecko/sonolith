# Architecture

How Sonolith is put together: where things live, how data and playback flow, and what the Rust side does. Read this
before changing code; [conventions.md](conventions.md) covers how to write it.

## Big picture

```
React UI (src/views, src/components)
   │  zustand stores (src/stores) ── localStorage (settings, volume, queue snapshot)
   │  api layer (src/api): youtubei.js + raw InnerTube JSON → defensive parsers → app types (api/types.ts)
   │        HTTP goes through tauri-plugin-http (makeYtFetch: cookie, SAPISIDHASH, X-Goog-AuthUser)
   │
   └─ invoke("…") / events ──► Rust (src-tauri/src): keyring auth, stream proxy, yt-dlp, MPRIS, tray,
                                Discord IPC, updates, fonts, render flags
<audio> element in the webview plays the stream (direct googlevideo URL or the local Rust proxy).
```

The frontend does almost everything; Rust only does what the webview can't (OS integration, secrets, sockets,
spawning processes, CORS-free streaming).

## Frontend layout (`src/`)

| Path | Role |
| --- | --- |
| `main.tsx` | Applies appearance **before the first render** (`applyTheme`, `applyLayout`, webview zoom), blocks the browser context menu/reload shortcuts, mounts `<App>` in StrictMode. |
| `views/SettingsView.tsx` + `views/settings/kit.tsx` | Settings: grouped categories on the left (one pastel icon hue per group), one category per page on the right (narrow: list, then page with a back arrow). Pages are built from `SettingCard` / `SettingRow` / `Segmented`; a row's `id` becomes `data-setting`, so `openSettings(section, focus)` (What's new, onboarding) opens a category and highlights that row. Sections: `SETTINGS_SECTIONS` in `stores/nav.ts`. |
| `App.tsx` | Shell: Sidebar, TopBar, MainView, QueuePanel, NowPlaying overlay, PlayerBar, dialogs (Credits, Update, Confirm), Toast. Runs one-time inits (auth, media keys, tray, Discord, MPRIS, history, updates). |
| `index.css` | Theme tokens (`--c-*` on `:root`, the built-in YT Music look), Tailwind `@theme inline` color/radius mapping, base styles, `.icon-btn`, `.chip`, `.skeleton`, scrollbars, compact density. |
| `api/` | Everything that talks to YouTube. `ytm.ts` is the facade the UI calls. See below. |
| `stores/` | zustand stores and pure logic. See below. |
| `views/` | One component per route (Home, Explore, Browse, Library, Search, Album, Artist, Playlist, Podcast, Channel, History, Settings) + `NowPlaying.tsx` overlay. `MainView.tsx` switches on the route. |
| `components/` | Shared UI: PlayerBar, Slider, Switch, TrackList, QueueList, QueueChips, Card, Shelves, PageHeader, Menu/ItemMenu (⋮ menus), dialogs, Thumb, Status (Loading/ErrorBox/EmptyState), ReleaseNotes. `components/appearance/` = Settings → Appearance. |
| `theme/` | Theme engine: tokens, palettes, color math, appearance settings shape + migration, cover-art accent, font stacks. |
| `hooks/useData.ts` | Page data cache: `useAsync(key, fn)`, `usePaged(key, first)`, `prefetch`, `invalidate(key)`. |
| `motion/` | Motion engine: analytic spring solver + M3 presets (`spring.ts`), one shared rAF loop with the central animations switch and pause-while-hidden (`engine.ts`: `Spring`, `tween`, `ticker`, `setMotionEnabled`), delegated shape morph for M3 buttons (`morph.ts`), `useSpring`. |
| `views/nowplaying/` | Now Playing layouts inside the `NowPlaying.tsx` shell (slide, ambient, Esc, Try-the-looks card): `Classic.tsx` (pre-2.0, unchanged), `Material.tsx`, `Bento.tsx`; `shared.tsx` = Up next / Lyrics / Related panels; `parts.tsx` = M3 pieces (cover, links, seek bar, transport, slide-in panel). |
| `onboarding/` | First-run welcome: fresh-install detection (`detect.ts`, pure + tested: stored settings with or without `onboardingCompleted`, other 1.x keys, keyring cookie, native files via `app_has_prior_data`), startup/finish (`store.ts`, runs What's new after deciding), the lazy-loaded layer (`Onboarding.tsx`) and its steps. Existing installs never see it unasked; Settings → About → Run setup again re-opens it (`rerunOnboarding`: current settings, no flags or What's new, Done returns to About). |
| `playback/` | Video in Now Playing (`videoSync.ts`, pure + tested): the muted `<video>` of a podcast episode or music video (`Track.video`, from `/next`'s music video type OMV/UGC; songs have only a still) follows the `<audio>` clock at its rate, seeking ahead (by the measured seek time) only when more than 0.25 s off and never while a seek is landing; `components/TrackVideo.tsx` runs it every 250 ms and on audio events, via the local proxy on Linux. Smooth playhead (`playhead.ts`): an interpolator between the audio clock's coarse steps and one frame loop (on the motion ticker) for karaoke lyrics; runs only while playing with a listener, otherwise listeners hear the clock's events. Seek bars deliberately stay on the 1 Hz `progress.ts` clock (the per-frame seek bar cost too much CPU on WebKitGTK). |
| `visualizer/` | Now Playing's audio visualizer (Settings → Now Playing: Background, On the cover, Glow; bars or wave). `tap.ts` plays a silent copy of the current stream (a second `<audio>` through the local proxy, kept in step with the player, captured by Web Audio and ending in a zero gain) and analyses it; the player's own element is never routed through Web Audio. `spectrum.ts` (pure, tested) turns FFT bins into smoothed log bands and paces frames; `Visualizer.tsx` draws a canvas at 1 canvas px per CSS px (the glow: a pre-drawn sprite stamped with an alpha) on the motion ticker at ≤ 30 fps (24 unfocused, optional); it stops when paused, hidden or closed, and so does the copy. |
| `lyrics/` | Lyrics in the frontend: provider settings + normalizer (`providers.ts`), pure picking / quality tiers / current line (`pick.ts`), the store that fetches for the playing track while Now Playing is visible and upgrades in place as better tiers arrive over a channel (`store.ts`), the karaoke driver (`karaoke.ts`: Sweep / Glow / Bounce / Simple as pure functions of the clock, breathing dots in breaks, background vocals), the synced view (`LyricsView.tsx`) and Settings → Lyrics (providers, karaoke style with previews). Backend: `src-tauri/src/lyrics/` (providers, parsers, matching, selection, cache; `lyrics_get`). |
| `shortcuts/` | In-window keyboard shortcuts (separate from the global media keys in `stores/mediaKeys.ts`): pure matching by `event.key`, typing / dialog guards, conflicts and the normalizer (`keys.ts`, tested), the one window listener (`init.ts`), tooltip hints (`hint.ts`), the volume indicator and Settings → Keyboard shortcuts. |
| `whatsNew/` | "What's new" after an update: typed entries (`entries.ts`), selection + numeric semver (`select.ts`), store/actions/startup (`store.ts`), dialog. Entries are added only for releases (maintainers write them; contributors don't). |
| `localApi/` | The frontend half of the local API for other apps (api/SPEC.md; the server is `src-tauri/src/api/`): `init.ts` answers the server's `api:call` events through `dispatch.ts` (every frontend method, on the UI's stores and `ytm.ts`), `publish.ts` sends player / queue (revision + change reason) / account / lyrics state with `api_publish`, `convert.ts` maps app types to the API's, `paging.ts` cursors, `ConsentDialog.tsx`, `ConnectedAppsSettings.tsx`, `store.ts` (status, open consents). `schema.gen.ts` is generated by `api/tools/generate.py`. |
| `dev/` | Dev toolkit (Dev build chip + panel). **Dev builds only**: loaded solely by `main.tsx` inside `if (import.meta.env.DEV)` via dynamic import; fills `stores/devSlot.ts`. Nothing else may import it (`dev/isolation.test.ts`, `scripts/check-dev-isolation.sh`). |

### API layer (`src/api/`)

- `client.ts` / `innertube.ts`: youtubei.js `Innertube` setup (runtime-agnostic so `scripts/dbg.ts` shares it),
  `makeYtFetch` (cookie header, SAPISIDHASH per origin, `X-Goog-AuthUser` / `X-Goog-PageId`). Locale is `hl=en`.
  Account switcher (avatar menu): `accounts.ts` parses `music.youtube.com/getAccountSwitcherEndpoint` (the Google
  accounts in the cookie and their channels); a choice is the session index (`X-Goog-AuthUser`) plus, for a brand
  account, its page id (`context.user.onBehalfOfUser`, stripped from the anonymous mobile stream requests). It's kept
  in `localStorage["account"]`; `useAuth().switchAccount` drops cached data and bumps `accountGen`, which remounts
  the view. A 401 while acting as another account falls back to the main one instead of signing out.
  Signed out, `getClient()` is anonymous (browse, search, playback work); account calls go through
  `getAccountClient()` / `accountExec` in `ytm.ts` and throw `AuthError` signed out. Only Library and History show
  the sign-in prompt (`ACCOUNT_ROUTES` in `MainView.tsx`).
- `raw.ts`, `browse.ts`, `queue.ts`, `menu.ts`, `podcast.ts`: **raw InnerTube JSON** (WEB_REMIX client, `parse:false`)
  with **defensive parsers** — unknown nodes are skipped, never thrown on. Used for home/explore/library/search,
  `/next` (queue, chips, related, lyrics), menus, podcasts.
- `mappers.ts`: maps youtubei.js parsed nodes (playlist/album/artist pages) to app types, accessed structurally.
- `stream.ts`: picks an audio stream. Order: InnerTube **YTMUSIC** (fast, Premium 256 kbps) → **VISIONOS** (complete
  streams without Premium, sent without cookies) → **yt-dlp** (Rust spawns it, ~8 s). `<audio>` errors walk a
  recovery ladder (same URL via the local proxy → the other resolver). Failures are logged to `debug/playback.log`.
- `ytm.ts`: the facade (getHome, getPlaylist, search, rate, addToPlaylist, removeFromPlaylist, createPlaylist,
  deletePlaylist, getWatch, startRadio, recordHistory, …). `exec(endpoint, body)` = raw call.
- `types.ts`: `Track`, `Item`, `Playlist`, `Album`, `Shelf`, `Page<T>` (`items` + `loadMore`), menus, etc.

### Stores (`src/stores/`)

- `player.ts`: the player — one module-level `Audio`, queue/index/status/shuffle/repeat/context, `playQueue`,
  `playRadio`, `playNext`/`addToQueue` (one track or many), chips, autoplay, stream loading and error recovery,
  prefetch of the next stream, queue snapshot persistence. Exposes `playbackTime()` / `onPlaybackTick()` for
  bookkeeping that must run while the window is hidden.
- `progress.ts`: the playback clock, separate so ticks only re-render the progress bar. Updated **at most once per
  displayed second and not while the window is hidden**.
- Pure, unit-tested logic: `autoplay.ts`, `queueOps.ts` (reorder, insertNext, append, dedupe), `queueSnapshot.ts`,
  `playState.ts` (play/pause follows the audio element), `episodeProgress.ts` (local episode positions, resume,
  played marks), `podcastQueue.ts` (next episode of a show).
- `settings.ts`: persisted settings (`localStorage["settings"]`, flat JSON merged over defaults; `appearance` goes
  through `normalizeAppearance`). Writes are debounced 300 ms and flushed on hide/pagehide.
- `library.ts`: sidebar playlists (all library pages), optimistic create/delete/count, lagged reloads (YouTube's
  library listing lags behind edits).
- `nav.ts` (route + history), `ui.ts` (Now Playing open/covering, dialogs; there is no side queue panel since 2.0, the queue lives in Now Playing), `toast.ts`, `auth.ts`, `update.ts`.
- Integrations: `mpris.ts` (Linux, snapshots → Rust), `mediaKeys.ts` (global shortcuts + tray menu), `discord.ts`
  (Discord Rich Presence, rate-limited), `history.ts` (YTM history ping after 10 s), `coverColors.ts` ("Colors from album
  art": source color → `theme/albumScheme.ts` M3 TonalSpot scheme → all tokens, cached per cover, one tween per
  track change).
  Its setting is `off | app | nowPlaying`: "nowPlaying" writes every token onto Now Playing's root only
  (`setCoverScope` / `applyScopedTheme`, `data-theme-scope`, where m3.css declares the color roles again).
- `actions.ts`: UI actions on items: activate (radio or open), `playItem`, `queueCollection` (Play next / Add to
  queue / Shuffle for albums & playlists), hover prefetch.

### Theming (`src/theme/`)

- Colors are **semantic CSS tokens** `--c-<name>` (`tokens.ts` `DEFAULT_TOKENS` mirrors `index.css :root`; a test
  enforces it). Tailwind sees them via `@theme inline` (`bg-fg/10`, `bg-scrim/60`, `bg-button`, `text-on-accent`…).
- A palette (16 Material-style colors, `palettes.json`, ~117 bundled) maps to tokens in `paletteTokens()`. Built-in
  look = id `ytm` = no inline tokens at all. User overrides sit on top; some tokens follow others (`FOLLOWS`:
  slider-fill←accent, …). `applyTheme` writes only inline custom properties on `<html>`.
- `appearance.ts`: the Appearance settings shape (palette, mode, overrides, ambient, coverAccent, radius, density,
  zoom, font, **uiStyle** `m3|classic`, **nowPlayingLayout** `material|bento|classic`, **animations**) +
  `normalizeAppearance` (migration/validation; also used for theme import, which keeps the user's own animations).
- **Material 3 style** (2.0): `m3.ts` derives M3 color roles (`--m3-primary`, `-container`, surface containers…)
  from the `--c-*` tokens; `m3.css` holds the same recipes as `color-mix()` (a test keeps them in sync), the corner
  scale (`--m3-corner-*`, plain px written by `applyLayout` from the corner setting) and the type scale
  (`type-*` / `type-*-em` utilities). `m3-components.css` styles components under `[data-ui-style="m3"]`
  (unlayered, so it beats the shared Tailwind classes). `applyStyle` puts `data-ui-style` / `data-animations` on
  `<html>`; `components/UiStyle.tsx` (`UiStyleScope`, `useUiStyle`) lets M3 parts (Material/Bento Now Playing,
  dev panel) be M3 inside the Classic app. `settings.lastSeenVersion` drives What's new.

## Rust backend (`src-tauri/src/`)

| Module | Does |
| --- | --- |
| `lib.rs` | Builder: single-instance (second launch shows the window), plugins (http, opener, global-shortcut), setup (MPRIS, tray, render flags), close-to-tray, command registration, `log_playback`. |
| `auth.rs` | Google sign-in window, cookie in the OS keyring (service `sonolith`; an empty one is filled from the old `ytdesk` entry on read, which stays until sign-out clears both) (`auth_get_cookie`, `auth_set_cookie`, `auth_clear`, `auth_login`). |
| `proxy.rs` | Local HTTP Range proxy for streams the webview refuses directly, and for the visualizer's copy of the stream (it sends CORS headers, googlevideo doesn't for the app) (`proxy_url`, `stream_probe`). |
| `ytdlp.rs` | Managed yt-dlp binary (install, weekly `-U`, custom path, JS runtime detection, temp cookies) — `ytdlp_status/install/update/set_path/stream_url`. |
| `mpris.rs` | Linux: native MPRIS over zbus (`org.mpris.MediaPlayer2.sonolith`); `mpris_update` snapshots in, `mpris` events out. |
| `tray.rs` | Tray icon + menu ("Show/Hide Sonolith" first), `tray_update`, show/hide/toggle window; Windows left click shows the window; Linux AppIndicator title set to "Sonolith". |
| `discord.rs` | Discord IPC worker (`discord_set`, `discord_disconnect`): probes only existing socket dirs, sleeps when idle. |
| `update.rs` | GitHub releases: `update_check` (with AUR package detection via `pacman -Qqo`), `update_changelog`, `update_open_page`, `update_install` (Windows installer, sha256-verified), `open_credit`. All URLs built from `REPO`. |
| `fonts.rs` | `fonts_list`: installed font families via `fontdb` (blocking thread). |
| `migrate.rs` | One-time copy of the app's data from its previous identifier (`dev.ytdesk.app`, the name before 2.3.0) to `dev.sonolith.app`. Runs in `run()` **before the builder** (Tauri creates the config window, and its webview data dir, before `setup`): temp sibling + rename, skips browser caches, keeps the old dirs, marker `.migrated-from-ytdesk`, logs to playback.log. Tested with temp dirs. |
| `render.rs` | Flags in the app config dir: GPU rendering on/off, close-to-tray, local API on/off. |
| `api/` | Local API server (api/SPEC.md), off by default: `transport.rs` (Unix socket / named pipe + discovery.json), `server.rs` (connections, registration + consent, sessions, scopes, rate limits, events, position and lyric timing from the published state, the `api:call` bridge with a 25 s timeout; `api:cancel` tells the frontend to stop a call on timeout or when its connection closes, and the dispatcher checks the `AbortSignal` between YouTube requests), `store.rs` (`api-apps.json`: apps with hashed tokens, denials, blocks), `identity.rs` + `peer.rs` / `win.rs` (who connects), `methods.rs` (method table, checked against openrpc.json by a test), `validate.rs` (params of frontend methods checked against the spec), `notify.rs` (consent notifications), `tests.rs` (integration tests). Commands `api_*` in `mod.rs`. |

Commands that do file/keyring I/O are `#[tauri::command(async)]` so they never block the GTK main thread. On
non-Linux, `mpris_update` is a no-op stub.

## Platform differences

- **Linux**: MPRIS from Rust; the webview's `navigator.mediaSession` gets an **empty title** so WebKitGTK doesn't
  export a second, metadata-less MPRIS player (`player.ts`). Rendering can be switched to CPU (Settings).
- **Windows**: the webview's Media Session drives SMTC; WebView2 can't play YouTube's AAC/MP4, so Opus/WebM is
  preferred; updates install via the downloaded NSIS installer.
- **Arch (AUR install)**: the update dialog shows `yay/paru -S <package>` instead of a download.
