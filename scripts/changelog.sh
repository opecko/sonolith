#!/usr/bin/env bash
# Prints a Markdown changelog for a release tag: every commit since the previous v* tag (or the whole history for
# the first release), without version-bump commits.
#   scripts/changelog.sh v1.1.1
set -euo pipefail
tag=${1:?usage: scripts/changelog.sh <tag>}
prev=$(git describe --tags --abbrev=0 --match 'v*' "$tag^" 2>/dev/null || true)
range=${prev:+$prev..}$tag

echo "## Changes"
echo
git log --no-merges --reverse --pretty='- %s' "$range" | grep -vE '^- Version [0-9]+\.[0-9]+\.[0-9]+$' || echo "- Maintenance release"
echo
if [ -n "$prev" ]; then
  echo "**Full diff:** [\`$prev...$tag\`](${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/compare/$prev...$tag)"
  echo
fi
cat <<'MD'
## Downloads

| Platform | File |
| --- | --- |
| Windows 10/11 (x64) | `ytdesk_*_x64-setup.exe` |
| Debian / Ubuntu 24.04+ | `ytdesk_*_amd64.deb` |
| Arch Linux | from the AUR: `yay -S ytdesk-bin` or `paru -S ytdesk-bin` |

Checksums are in `SHA256SUMS`.
MD
