#!/usr/bin/env bash
# Builds the Void Linux package (.xbps, x86_64 glibc) from the current HEAD with xbps-src inside the official Void
# container, so it works on any distribution with Docker. Not part of scripts/release.sh.
#
#   scripts/void-build.sh                  # build, copy to release/void/, print sha256, remove build files
#   scripts/void-build.sh --keep-cache     # same, but keep the cargo and xbps download caches for the next run
#   VOID_PACKAGES=~/void-packages scripts/void-build.sh   # use another void-packages clone
#
# Output: release/void/sonolith-<version>_1.x86_64.xbps and its repository index (x86_64-repodata). The package is
# built against the current Void libraries; rebuild it when Void updates WebKitGTK or other libraries it links.
# Uses the template in packaging/void/ with the version from package.json and the checksum of a tarball of HEAD
# (uncommitted changes are not included). Takes ~15-20 min and several GB of disk while it runs.
set -euo pipefail

cd "$(dirname "$0")/.."
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

keep_cache=0
[ "${1:-}" = --keep-cache ] && keep_cache=1
image=ghcr.io/void-linux/void-glibc-full:latest
vp=${VOID_PACKAGES:-$HOME/void-packages-work}
jobs=${JOBS:-3} # 3 rustc jobs keep an 8 GB machine out of swap
command -v docker >/dev/null || die "missing docker"
ver=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json)
[[ $ver =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "can't read the version from package.json"
[ -z "$(git status --porcelain --untracked-files=no)" ] || echo "note: uncommitted changes are not in the build (it uses HEAD)"

if [ ! -x "$vp/xbps-src" ]; then
  echo "== cloning void-packages into $vp"
  git clone --depth 1 https://github.com/void-linux/void-packages "$vp"
fi

# Everything under hostdir/ and masterdir is written by root in the container, so remove it from a container too.
in_void() { docker run --rm -v "$vp:/w" "$image" sh -c "$1"; }
tmp=
cleanup() {
  echo "== removing build files"
  [ -z "$tmp" ] || rm -rf "$tmp"
  local what="/w/masterdir /w/srcpkgs/sonolith /w/hostdir/binpkgs /w/hostdir/sources/sonolith-* /w/hostdir/builddir*"
  [ $keep_cache = 1 ] || what="/w/masterdir /w/srcpkgs/sonolith /w/hostdir"
  in_void "rm -rf $what" || echo "warning: cleanup failed, remove $vp/hostdir and $vp/masterdir by hand (root-owned)"
  docker rm -f sonolith-void-build >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== preparing sonolith $ver from $(git rev-parse --short HEAD)"
in_void "rm -rf /w/hostdir/sources/sonolith-$ver /w/hostdir/binpkgs /w/srcpkgs/sonolith /w/masterdir"
tmp=$(mktemp -d "$vp/.sonolith-src.XXXXXX")
git archive --format=tar --prefix="sonolith-$ver/" HEAD | gzip -n > "$tmp/v$ver.tar.gz"
sum=$(sha256sum "$tmp/v$ver.tar.gz" | cut -d' ' -f1)
mkdir -p "$tmp/sonolith"
sed -e "s/^version=.*/version=$ver/" -e "s/^checksum=.*/checksum=$sum/" \
  packaging/void/srcpkgs/sonolith/template > "$tmp/sonolith/template"

echo "== building in $image (log: release/void/build.log)"
mkdir -p release/void
rm -f release/void/*.xbps release/void/x86_64-repodata
docker run --name sonolith-void-build --rm \
  -e XBPS_CHROOT_CMD=ethereal -e XBPS_ALLOW_CHROOT_BREAKOUT=yes \
  -e VER="$ver" -e SRC="$(basename "$tmp")" -e JOBS="$jobs" -e OWNER="$(id -u):$(id -g)" \
  -v "$vp:/hostrepo" -v "$PWD/release/void:/out" "$image" /bin/sh -c '
    set -e
    xbps-install -Syu xbps >/dev/null && xbps-install -Syu >/dev/null
    # base-chroot lives only in the bootstrap repository: base-devel plus the parts the build hooks need.
    xbps-install -y base-devel file bsdtar diffutils patch git bash >/dev/null
    git config --global --add safe.directory /hostrepo
    echo x86_64 > /.xbps_chroot_init
    cd /hostrepo
    ln -sfn / masterdir
    mkdir -p hostdir/sources/sonolith-$VER srcpkgs
    mv $SRC/v$VER.tar.gz hostdir/sources/sonolith-$VER/
    mv $SRC/sonolith srcpkgs/
    rm -rf $SRC
    ./xbps-src -j$JOBS -Q pkg sonolith
    cp hostdir/binpkgs/sonolith-${VER}_*.x86_64.xbps hostdir/binpkgs/x86_64-repodata /out/
    chown $OWNER /out/*
  ' > release/void/build.log 2>&1 || { tail -n 30 release/void/build.log; die "build failed (release/void/build.log)"; }
echo "== done"
(cd release/void && sha256sum ./*.xbps)
