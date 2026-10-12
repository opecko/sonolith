#!/usr/bin/env bash
# Updates the AUR packages (packaging/aur/ytdesk, packaging/aur/ytdesk-bin) to a published GitHub release.
#
#   scripts/aur.sh 1.2.2           # set pkgver, fill sha256sums from the release, regenerate .SRCINFO
#   scripts/aur.sh 1.2.2 --push    # then commit both to aur.archlinux.org (needs your SSH key on AUR)
#
# Run it after scripts/release.sh --publish: the sources are the release's .deb, the tag's tarball and LICENSE.
set -euo pipefail

cd "$(dirname "$0")/.."
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

ver=${1:-}
[[ $ver =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "usage: scripts/aur.sh <version> [--push]"
push=0
[ "${2:-}" = --push ] && push=1
command -v makepkg >/dev/null || die "missing makepkg (Arch only)"

repo=https://github.com/opecko/ytdesk
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

sha() {
  curl -fsSL -o "$tmp/f" "$1" || die "can't download $1 (is v$ver published?)"
  sha256sum "$tmp/f" | cut -d' ' -f1
}
deb=$(sha "$repo/releases/download/v$ver/ytdesk_${ver}_amd64.deb")
license=$(sha "https://raw.githubusercontent.com/opecko/ytdesk/v$ver/LICENSE")
tarball=$(sha "$repo/archive/refs/tags/v$ver.tar.gz")

# Sets pkgver, resets pkgrel and replaces the whole sha256sums=(…) array (one or more lines) with the given sums.
update() {
  local file=$1
  shift
  python3 - "$file" "$ver" "$@" <<'PY'
import re, sys
path, ver, *sums = sys.argv[1:]
s = open(path).read()
s = re.sub(r"^pkgver=.*$", f"pkgver={ver}", s, count=1, flags=re.M)
s = re.sub(r"^pkgrel=.*$", "pkgrel=1", s, count=1, flags=re.M)
arr = "sha256sums=(" + "\n            ".join(f"'{x}'" for x in sums) + ")"
s, n = re.subn(r"^sha256sums=\([^)]*\)", arr, s, count=1, flags=re.M)
if n != 1:
    sys.exit(f"{path}: no sha256sums=() array")
open(path, "w").write(s)
PY
}

update packaging/aur/ytdesk-bin/PKGBUILD "$deb" "$license"
update packaging/aur/ytdesk/PKGBUILD "$tarball"

for p in ytdesk ytdesk-bin; do
  (cd "packaging/aur/$p" && makepkg --printsrcinfo > .SRCINFO)
done
echo "packaging/aur updated to $ver"

[ "$push" = 1 ] || exit 0
for p in ytdesk ytdesk-bin; do
  git clone -q "ssh://aur@aur.archlinux.org/$p.git" "$tmp/$p"
  cp "packaging/aur/$p/PKGBUILD" "packaging/aur/$p/.SRCINFO" "$tmp/$p/"
  git -C "$tmp/$p" add PKGBUILD .SRCINFO
  if git -C "$tmp/$p" diff --cached --quiet; then
    echo "$p: already up to date on AUR"
    continue
  fi
  # The temporary clone has no identity of its own: commit as this repo's author.
  git -C "$tmp/$p" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" commit -q -m "Update to $ver"
  git -C "$tmp/$p" push -q origin HEAD:master
  echo "$p: pushed $ver to https://aur.archlinux.org/packages/$p"
done
