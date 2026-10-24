#!/bin/sh
# Builds both Arch packages in a clean archlinux container; results land in packaging/out/.
# Usage: packaging/arch/docker-build.sh [bin|src|all]   (needs Docker; runs make-src.sh first)
set -eu
cd "$(dirname "$0")/../.."
what=${1:-all}
packaging/arch/make-src.sh
mkdir -p packaging/out
docker run --rm -v "$PWD/packaging:/in:ro" -v "$PWD/packaging/out:/out" archlinux:latest bash -euc "
  pacman -Syu --noconfirm --needed base-devel sudo >/dev/null
  useradd -m builder && echo 'builder ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/builder
  build() { cp -r /in/\$1 /home/builder/\$1 && chown -R builder /home/builder/\$1
    su builder -c \"cd /home/builder/\$1 && makepkg -s --noconfirm\"
    cp /home/builder/\$1/*.pkg.tar.zst /out/; }
  case $what in bin) build arch-bin ;; src) build arch ;; *) build arch-bin; build arch ;; esac
  # Smoke test each package on its own (they conflict): install, check every library resolves, remove.
  for p in /out/*.pkg.tar.zst; do
    pacman -U --noconfirm \$p >/dev/null
    if ldd /usr/bin/sonolith | grep 'not found'; then exit 1; fi
    echo \"ok: \$(basename \$p) installs, all libraries found\"
    pacman -Rns --noconfirm \$(pacman -Qqo /usr/bin/sonolith) >/dev/null
  done
  chown -R $(id -u):$(id -g) /out
"
ls -la packaging/out
