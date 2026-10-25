## What and why

<!-- What does this change, and why? Link the issue: "Fixes #123". -->

## How I tested it

<!-- Commands you ran, and what you tried in the running app (OS, Material 3 / Classic, dark / light). -->

## Screenshots

<!-- For UI changes: Material 3 and Classic, dark and light. A short GIF is fine for motion. Delete if not a UI change. -->

| | Dark | Light |
| --- | --- | --- |
| Material 3 | | |
| Classic | | |

## Checklist

- [ ] Small and focused, rebased on the latest upstream default branch
- [ ] Verify step passes: `npx tsc --noEmit`, `npx vitest run`, `cargo check` (in `src-tauri/`), `python3 api/tools/generate.py --check`
- [ ] Colors only through theme tokens, icons from lucide-react, English sentence-case UI text
- [ ] Both styles (Material 3 and Classic) and all Now Playing layouts still work (if the UI is touched)
- [ ] Tests added or updated for new logic
- [ ] **No** version bump, release notes, What's new entry or packaging change
- [ ] I read the whole diff and can explain it (including anything an AI assistant wrote)
- [ ] I agree my contribution is licensed under the MIT license
