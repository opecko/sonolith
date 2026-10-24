#!/usr/bin/env bash
# Publishes locally built packages from release/<version>/ as a GitHub release, with a changelog. Tags HEAD as
# v<version> if the tag doesn't exist yet and pushes the branch and tag. An existing release gets its files replaced.
# Hand-written highlights in release/notes/<version>.md (optional) go above the generated changelog.
#   scripts/publish.sh            # version from src-tauri/tauri.conf.json
#   scripts/publish.sh 1.2.0
set -euo pipefail
cd "$(dirname "$0")/.."

ver=${1:-$(jq -r .version src-tauri/tauri.conf.json)}
tag=v$ver
dir=release/$ver
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v gh >/dev/null || die "missing 'gh' (GitHub CLI)"
gh auth status >/dev/null 2>&1 || die "not signed in to gh (gh auth login)"
[ -f "$dir/SHA256SUMS" ] || die "no packages in $dir; run scripts/release.sh first"
(cd "$dir" && sha256sum --quiet -c SHA256SUMS) || die "$dir doesn't match its SHA256SUMS"

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "tag $tag exists ($(git rev-parse --short "$tag^{commit}"))"
else
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "uncommitted changes; commit before tagging $tag"
  git tag "$tag"
  echo "tagged HEAD as $tag"
fi
git push -q origin HEAD
git push -q origin "$tag"

export GITHUB_REPOSITORY
GITHUB_REPOSITORY=$(gh repo view --json nameWithOwner -q .nameWithOwner)
notes=$(mktemp)
trap 'rm -f "$notes"' EXIT
extra=release/notes/$ver.md
{ [ -f "$extra" ] && { cat "$extra"; echo; }; scripts/changelog.sh "$tag"; } > "$notes"

files=("$dir"/*)
if gh release view "$tag" >/dev/null 2>&1; then
  gh release edit "$tag" --notes-file "$notes"
  gh release upload "$tag" "${files[@]}" --clobber
else
  gh release create "$tag" "${files[@]}" --verify-tag --title "Sonolith $ver" --notes-file "$notes"
fi
gh release view "$tag" --json url -q .url

# ---------- bridge for ytdesk builds ----------
# ytdesk (≤ 2.2.0) checks github.com/opecko/ytdesk and installs ytdesk_<ver>_x64-setup.exe only from download URLs
# under that repo, so through the rename redirect it finds updates but can't install them. A small repo under the
# old name (README pointing here) gets the same release with the installer under its old name; ytdesk builds update
# from it into Sonolith. Skipped while opecko/ytdesk is just the redirect to this repo.
bridge=opecko/ytdesk
if [ "$(gh repo view "$bridge" --json nameWithOwner -q .nameWithOwner 2>/dev/null)" = "$bridge" ]; then
  bdir=$(mktemp -d)
  trap 'rm -f "$notes"; rm -rf "$bdir"' EXIT
  cp "$dir/sonolith_${ver}_x64-setup.exe" "$bdir/ytdesk_${ver}_x64-setup.exe"
  [ -f "$dir/sonolith_${ver}_amd64.deb" ] && cp "$dir/sonolith_${ver}_amd64.deb" "$bdir/"
  (cd "$bdir" && sha256sum -- * > SHA256SUMS)
  bnotes="$bdir/notes.md"
  { printf '**ytdesk is now Sonolith.** This is a copy of [Sonolith %s](https://github.com/%s/releases/tag/%s) for ytdesk'"'"'s updater; Sonolith itself lives at https://github.com/%s.\n\n' "$ver" "$GITHUB_REPOSITORY" "$tag" "$GITHUB_REPOSITORY"; cat "$notes"; } > "$bnotes"
  bfiles=("$bdir"/*_x64-setup.exe "$bdir"/*.deb "$bdir/SHA256SUMS")
  if gh release view "$tag" -R "$bridge" >/dev/null 2>&1; then
    gh release edit "$tag" -R "$bridge" --notes-file "$bnotes"
    gh release upload "$tag" -R "$bridge" "${bfiles[@]}" --clobber
  else
    gh release create "$tag" -R "$bridge" "${bfiles[@]}" --title "Sonolith $ver (ytdesk is now Sonolith)" --notes-file "$bnotes"
  fi
  gh release view "$tag" -R "$bridge" --json url -q .url
else
  echo "no bridge repo $bridge yet (or it's the rename redirect): ytdesk builds can't install this release themselves" >&2
fi
