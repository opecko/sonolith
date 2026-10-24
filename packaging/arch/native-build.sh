#!/bin/sh
# Builds the Arch packages directly on this (Arch-based) machine with makepkg; results land in packaging/out/.
# Usage: packaging/arch/native-build.sh [bin|src|all]   (runs make-src.sh first; needs no root)
# The dependencies must already be installed (makepkg checks them but never installs anything). The smoke test
# extracts each package and checks that every library of the binary resolves, without installing it.
set -eu
cd "$(dirname "$0")/../.."
what=${1:-all}
packaging/arch/make-src.sh
mkdir -p packaging/out
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

build() {
  cp -r "packaging/$1" "$work/$1"
  (cd "$work/$1" && PKGDEST="$work/pkg-$1" makepkg --noconfirm --cleanbuild >/dev/null)
  for p in "$work/pkg-$1"/*.pkg.tar.zst; do
    root="$work/root-$1"
    mkdir -p "$root"
    bsdtar -xf "$p" -C "$root"
    if ldd "$root/usr/bin/sonolith" | grep 'not found'; then
      echo "smoke test failed: $(basename "$p") has unresolved libraries" >&2
      exit 1
    fi
    echo "ok: $(basename "$p") builds, all libraries found"
    cp "$p" packaging/out/
  done
}

case $what in
  bin) build arch-bin ;;
  src) build arch ;;
  *) build arch-bin; build arch ;;
esac
ls -la packaging/out
