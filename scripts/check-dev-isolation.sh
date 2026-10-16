#!/usr/bin/env bash
# Builds the frontend into a temp dir (never dist/) and checks that the dev toolkit (src/dev) isn't in it.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-/tmp/ytdesk-verify}"
node_modules/.bin/vite build --outDir "$out" --emptyOutDir > /dev/null 2>&1
marker=$(sed -n 's/.*DEV_TOOLKIT_MARKER = "\([^"]*\)".*/\1/p' src/dev/index.tsx)
fail=0
for s in "$marker" "Dev build" "Developer tools" "Simulate update available" "mountDevTools" "Don't save played tracks to history" "skipHistory"; do
  n=$( (grep -rlF -- "$s" "$out" || true) | wc -l)
  echo "$s: $n"
  [ "$n" -eq 0 ] || fail=1
done
# Control: a string that must be there, so the grep itself works.
[ "$( (grep -rlF "Try out the new looks" "$out" || true) | wc -l)" -gt 0 ] || { echo "control string missing"; fail=1; }
[ "$fail" -eq 0 ] && echo "OK: no dev toolkit in the build" || { echo "FAIL: dev toolkit leaked into the build"; exit 1; }
