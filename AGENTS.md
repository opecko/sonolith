# Working on Sonolith (rules for AI coding assistants)

Sonolith is a Tauri 2 (Rust) + React/TypeScript desktop YouTube Music client. These are the rules for any AI
assistant (Claude Code, Codex, Cursor, Copilot, …) working in this repository on behalf of a contributor.
`CLAUDE.md` imports this file, so there is one set of rules; edit it here.

## At the start of a session

1. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) (setup, conventions, verify step, pull request process).
2. Read [`docs/dev/README.md`](docs/dev/README.md), then the doc for the task:
   [`architecture.md`](docs/dev/architecture.md) (where things live, data flow),
   [`conventions.md`](docs/dev/conventions.md) (style, theming tokens, animation and performance rules),
   [`workflows.md`](docs/dev/workflows.md) (verify, run, debug, API spec generator, testing),
   [`pitfalls.md`](docs/dev/pitfalls.md) (known traps: check before debugging anything odd).
3. Keep the docs current: when you learn something the next contributor needs (a trap, a changed workflow), update
   the matching doc in `docs/dev/` in the same change.

## Rules

- **Verify before you say it's done.** Run the four checks from CONTRIBUTING.md and report honestly what passed and
  what you didn't or couldn't run (e.g. "not tried in the running app"):
  `npx tsc --noEmit`, `npx vitest run`, `cargo check` (in `src-tauri/`), `python3 api/tools/generate.py --check`.
- **One logical change per commit**, with an English subject in the style of `git log` ("Area: what changed and
  why"). Don't mix refactors, formatting and features.
- **English everywhere**: code comments, UI text (sentence case), commit messages, docs.
- **Never bump versions, write release notes or "What's new" entries, touch packaging, or publish anything**, unless
  the maintainer asked for it in the issue or PR. Don't edit lockfiles by hand.
- **Never push to a remote that isn't the contributor's own** and never force-push shared branches. Commit locally
  and let the contributor push.
- **Ask before large refactors**, new dependencies, or changes to the public local API (`api/`): small, focused
  changes get reviewed and merged; sprawling ones don't.
- Don't read `node_modules/`, `target/` or lockfiles; grep and read focused ranges instead. When a library API is
  uncertain, check the installed types (for example `node_modules/youtubei.js/dist/`) instead of guessing.
- Never commit secrets: the YouTube cookie (`.env.local`), tokens, home-directory paths, local logs (`debug/`).

## Code conventions (full list in `docs/dev/conventions.md`)

- Colors only through theme tokens (`var(--c-…)`, `var(--m3-…)`, token Tailwind classes), never hex or `rgba()`
  outside `src/index.css` and `src/theme/`. Icons: `lucide-react` only.
- Both UI styles (Material 3 and Classic) and every Now Playing layout must keep working. Classic must not change
  unless the task is about it. Respect the animations setting (use `src/motion`, no ad-hoc loops).
- Logic goes into small pure modules with a vitest file next to them; stores and components stay thin.
- Parsers of YouTube responses never throw on unknown shapes.
- Never use CSS `transform`/`opacity` animations for anything that must not flicker: WebKitGTK flashes the old frame
  when they end. See `docs/dev/pitfalls.md`.
- Guard one-time inits against React StrictMode's double effects.
- Never let the frontend choose URLs to open or download; Rust builds them from constants or allow-lists.

## Generated files

`api/SPEC.md` and `api/llms.txt` (generated blocks), `api/openrpc.json` and `src/localApi/schema.gen.ts` are
produced by `python3 api/tools/generate.py`. Change the schemas or the generator, regenerate, then run `--check`.
