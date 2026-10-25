# Code conventions

How we write code in Sonolith. Pull requests are reviewed against this page; see
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the process.

Match the surrounding code: its comment density, naming and idioms. When unsure, find a similar feature and copy
its shape.

## General

- **Comments explain why**, in English, as JSDoc (`/** … */`) on exported things and short `//` notes at tricky
  spots ("WebKitGTK paints the old frame…", "YouTube lags behind edits…"). Don't narrate obvious code.
- **Small pure modules for logic, tested with vitest** next to the code (`foo.ts` + `foo.test.ts`). Keep stores and
  components thin; put rules into pure functions (`queueOps.ts`, `autoplay.ts`, `theme/*.ts`, parsers). Fixtures
  go in `__fixtures__/` (trimmed real responses).
- Prefer editing an existing module to adding a new one; no speculative abstractions.
- TypeScript strict, no unused locals/params. Rust: `cargo check` with no warnings.

## API / data

- **Never throw on unknown YouTube shapes.** Parsers skip what they don't understand (`raw.ts`, `queue.ts`,
  `menu.ts`). youtubei.js nodes are accessed structurally (`mappers.ts`).
- If a youtubei.js helper is broken, call InnerTube directly with `exec("/endpoint", body)` and say so in a comment
  (e.g. `deletePlaylist` uses `/playlist/delete`).
- Page data: `useAsync("<kind>:<id>", fn)` / `usePaged(key, first)`. After a mutation, call `invalidate(key)` — the
  open view refetches **in place** (old data stays until new data arrives). Keys in use: `playlist:<id>`,
  `album:<id>`, `artist:<id>`, `library:<section>`, …
- Mutations that YouTube applies lazily (library listing) get **optimistic UI + lagged reloads** (`library.ts`).
- Errors reach the user as a toast (`useToast.getState().show(msg)`, `"info"` for success) or an `ErrorBox` with
  retry. Messages are short English sentences: `Could not save to "X": <reason>`.

## State (zustand)

- Select primitives or use `useShallow`; never select a whole store in a component that renders often.
- One-time inits (listeners, subscriptions) live in `init*()` functions called from `App.tsx`; **guard them
  against React StrictMode's double effect** (module-level `started` flag, see `initMpris`).
- Values that tick (playback time) live outside React or in their own tiny store (`progress.ts`).
- Persisted state: localStorage with try/catch and validation on read (`settings.ts`, `normalizeAppearance`).

## UI

- **English UI**, sentence case labels ("Add to queue", "Delete playlist").
- **Icons: lucide-react only.**
- **Colors only through tokens**: `bg-[var(--c-surface)]`, `text-[var(--c-text-muted)]`, `border-[var(--c-outline)]`,
  or the Tailwind token colors (`bg-fg/10`, `bg-scrim/60`, `bg-button text-on-button`, `text-on-accent`). No
  `bg-white`, `text-black`, hex or `rgba()` outside `index.css :root` and `src/theme/`. Overlays on artwork use
  `scrim`; dialog backdrops use `--c-overlay`.
- Radius: `rounded-[var(--radius)]` or Tailwind `rounded-*` (mapped to `--radius`). Spacing: Tailwind steps (compact
  density shrinks `--spacing`).
- Shared building blocks: `Menu`/`ItemMenu` (⋮; add `data-more-menu` triggers so right-click finds them), `Slider`
  (`tooltip="value"` for volume-like sliders), `Switch`, `Thumb` (pass `px` for list-size art), `confirmAction()`
  for destructive actions (Cancel focused, says clearly what happens), `EmptyState`, `Loading`, `ErrorBox`.
- Dialogs: fixed overlay `bg-[var(--c-overlay)]`, panel `bg-[var(--c-surface-3)]` with `border-[var(--c-outline)]`,
  Esc and outside click close, `role="dialog"`/`"alertdialog"` + `aria-modal`.
- Accessibility basics: buttons have `aria-label` when icon-only; toggles use `aria-pressed`/`role="switch"`.

## Animation and performance (WebKitGTK is often software-rendered)

- **No CSS `transform`/`opacity` animations or transitions for anything that must not flicker** — WebKitGTK paints
  the pre-animation state for one frame when they end. Drive motion from `requestAnimationFrame` (`useSlide`,
  `AmbientLayer` in `NowPlaying.tsx`) or animate layout properties like `left` (`Switch.tsx`). Color transitions
  are fine. Spinners (`animate-spin`) are OK while mounted only during loading.
- No `content-visibility` (problematic on WebKitGTK). No CSS blur/backdrop-filter; the ambient light is a 12×12
  canvas stretched by the browser.
- Don't repaint big areas on timers: the clock updates once per second, not while hidden; hidden content under
  Now Playing is set `invisible`.
- List thumbnails at slot size (`Thumb px`), big art only where it's big.
- Debounce storage writes from continuous input (sliders); recompute only what changed (see `main.tsx` appearance
  subscription).

## Rust

- Keep Rust for what the webview can't do. Blocking work (`std::process`, file I/O, keyring, font scanning) goes to
  `spawn_blocking` or `#[tauri::command(async)]` — never block the GTK thread or the async runtime.
- Never let the frontend choose URLs to open or download: build them from constants (`REPO`) or allow-lists
  (`open_credit`).
- Errors cross the bridge as `Result<_, String>` with a readable message.

## Material 3 style (2.0) and Classic

- **Classic must not change.** Shared markup keeps its Tailwind classes; M3 differences are marker classes
  (`m3-btn m3-filled|m3-tonal|m3-outlined|m3-text|m3-danger|m3-medium|m3-fab`, `m3-seg`/`m3-segmented`,
  `m3-menu(-item)`, `m3-dialog`, `m3-row`, `m3-art(-lg|-xl)`, `m3-section`, `icon-btn m3-icon-*`…) styled only in
  `src/theme/m3-components.css` under `[data-ui-style="m3"]`. Markup forks (`Slider`, `Switch`, `PlayerBar`
  transport, `Status` list loading) go through `useUiStyle()`, never the setting directly.
- M3 colors: `var(--m3-<role>)` / Tailwind `bg-m3-…`, never new hex. Corners: `var(--m3-corner-*)` (follow the
  corner setting). Type: `type-title-large-em` etc.
- **State layers** are `color-mix(currentColor var(--sl), var(--ct))` with background-color transitions; never
  opacity animations.
- **Shapes** are declared per state (`--r-rest`, `--r-sel`, `--r-press`); `motion/morph.ts` springs between them
  via an inline `--r`. New morphing elements just declare the vars (and `data-morph` if not a button class).
- **Motion**: use `Spring`/`useSpring`/`tween`/`ticker` from `src/motion` — they jump to the end with animations
  off or while hidden. Don't write ad-hoc rAF loops. Write styles per frame directly (no React state per frame).
- Zustand selectors must not build new arrays/objects even with `useShallow` (`s.queue.slice(...)` loops
  forever); select the source and derive with `useMemo`.
