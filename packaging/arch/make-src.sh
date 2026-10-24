#!/bin/sh
# Prepares inputs for both Arch PKGBUILDs from the current checkout and fills in their sha256sums.
#   packaging/arch/sonolith-<ver>.tar.gz        (source build, from git HEAD)
#   packaging/arch-bin/sonolith_<ver>_amd64.deb (prebuilt, from the last `tauri build --bundles deb`)
set -eu
cd "$(dirname "$0")/../.."
ver=$(sed -n 's/^pkgver=//p' packaging/arch/PKGBUILD)
git archive --format=tar.gz --prefix="sonolith-$ver/" -o "packaging/arch/sonolith-$ver.tar.gz" HEAD
sum=$(sha256sum "packaging/arch/sonolith-$ver.tar.gz" | cut -d' ' -f1)
sed -i "s/^sha256sums=.*/sha256sums=('$sum')/" packaging/arch/PKGBUILD
deb="src-tauri/target/release/bundle/deb/sonolith_${ver}_amd64.deb"
if [ -f "$deb" ]; then
  cp "$deb" packaging/arch-bin/
  sum=$(sha256sum "$deb" | cut -d' ' -f1)
  sed -i "s/^sha256sums=.*/sha256sums=('$sum')/" packaging/arch-bin/PKGBUILD
else
  echo "no $deb yet: run 'npx tauri build --bundles deb' for the -bin package" >&2
fi
echo "ready: packaging/arch (source) and packaging/arch-bin (prebuilt); run makepkg -si in either"
