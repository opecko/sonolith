#!/usr/bin/env bash
# Builds every release package and collects them in release/<version>/ with SHA256SUMS.
#
#   scripts/release.sh                 # deb + arch + win
#   scripts/release.sh --only deb,win  # pick targets: deb, arch, win
#   scripts/release.sh --skip-tests    # skip tsc/vitest/cargo test preflight
#   scripts/release.sh --publish       # then tag, push and create the GitHub release (scripts/publish.sh)
#
# Shows numbered steps with elapsed time, a ✓/✗ summary with durations at the end, and logs everything to
# release/logs/release-<time>.log.
#
# Targets:
#   deb   Debian/Ubuntu package (native tauri build)
#   arch  Arch sonolith-bin package, repackaged from the deb with makepkg on this machine and smoke-tested (ldd)
#   win   Windows NSIS installer, cross-compiled with cargo-xwin
# Bump the version first in: src-tauri/tauri.conf.json, src-tauri/Cargo.toml, package.json, packaging/arch*/PKGBUILD.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD

targets="deb,arch,win"
run_tests=1
publish=0
while [ $# -gt 0 ]; do
  case $1 in
    --only) targets=$2; shift 2 ;;
    --skip-tests) run_tests=0; shift ;;
    --publish) publish=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
want() { [[ ",$targets," == *",$1,"* ]]; }

die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- progress: numbered steps, timings, log, summary ----------
# Everything (incl. tool output) also goes to release/logs/release-<time>.log.
mkdir -p "$ROOT/release/logs"
log="$ROOT/release/logs/release-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$log") 2>&1

steps_total=2 # preflight + checksums
[ "$run_tests" = 1 ] && steps_total=$((steps_total + 1))
{ want deb || want arch; } && steps_total=$((steps_total + 1))
want arch && steps_total=$((steps_total + 1))
want win && steps_total=$((steps_total + 1))
[ "$publish" = 1 ] && steps_total=$((steps_total + 1))

started=$(date +%s)
step_n=0
cur=""
cur_start=0
summary=()
restore_pkgbuilds=0

fmt_dur() { printf '%dm%02ds' $(($1 / 60)) $(($1 % 60)); }

finish_step() {
  [ -n "$cur" ] || return 0
  summary+=("$1|$cur|$(($(date +%s) - cur_start))")
  cur=""
}

step() {
  finish_step ok
  step_n=$((step_n + 1))
  cur="$*"
  cur_start=$(date +%s)
  printf '\n\033[1;36m==> [%d/%d] %s\033[0m  \033[2m(%s elapsed)\033[0m\n' "$step_n" "$steps_total" "$*" "$(fmt_dur $((cur_start - started)))"
}

on_exit() {
  local code=$?
  # make-src.sh (run by native-build.sh) fills sha256sums into the PKGBUILDs; put them back.
  [ "$restore_pkgbuilds" = 1 ] && git -C "$ROOT" checkout -- packaging/arch/PKGBUILD packaging/arch-bin/PKGBUILD 2>/dev/null
  finish_step "$([ "$code" = 0 ] && echo ok || echo FAILED)"
  printf '\n\033[1mSummary\033[0m (total %s)\n' "$(fmt_dur $(($(date +%s) - started)))"
  local row status name secs
  for row in "${summary[@]}"; do
    IFS='|' read -r status name secs <<<"$row"
    if [ "$status" = ok ]; then printf '  \033[32m✓\033[0m %-58s %s\n' "$name" "$(fmt_dur "$secs")"
    else printf '  \033[31m✗\033[0m %-58s %s\n' "$name" "$(fmt_dur "$secs")"; fi
  done
  if [ "$code" != 0 ]; then
    printf '\n\033[1;31mFailed\033[0m at step %d/%d. Full log: %s\n' "$step_n" "$steps_total" "$log"
  else
    printf '\nPackages: %s\nLog: %s\n' "${out:-}" "$log"
  fi
}
trap on_exit EXIT

# ---------- toolchain on PATH (rustup cargo, nvm node, llvm for clang-cl) ----------
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v node >/dev/null && [ -d "$HOME/.nvm/versions/node" ]; then
  node_dir=$(ls -d "$HOME"/.nvm/versions/node/v* | sort -V | tail -1)
  export PATH="$node_dir/bin:$PATH"
fi
llvm_dir=$(ls -d /usr/lib/llvm-*/bin 2>/dev/null | sort -V | tail -1 || true)
[ -n "$llvm_dir" ] && export PATH="$llvm_dir:$PATH"

# ---------- preflight ----------
step "Preflight"
need() { command -v "$1" >/dev/null || die "missing '$1' ($2)"; }
need cargo "install Rust via rustup"
need node "install Node (nvm)"
need npx "comes with Node"
need jq "sudo apt install jq"
if [ "$publish" = 1 ]; then
  need gh "https://cli.github.com"
  gh auth status >/dev/null 2>&1 || die "not signed in to gh (gh auth login)"
fi

if want arch; then
  need makepkg "build on Arch or an Arch-based distro"
  need bsdtar "pacman -S libarchive"
fi
if want win; then
  need makensis "sudo apt install nsis"
  need lld-link "sudo apt install lld"
  need llvm-rc "sudo apt install llvm"
  need clang "sudo apt install clang" # cargo-xwin provides its own clang-cl shim on top of it
  need cargo-xwin "cargo install --locked cargo-xwin"
  rustup target list --installed | grep -qx x86_64-pc-windows-msvc \
    || die "missing Rust target (rustup target add x86_64-pc-windows-msvc)"
fi

# All version strings must agree, or packages would disagree with each other.
ver=$(jq -r .version src-tauri/tauri.conf.json)
declare -A versions=(
  [package.json]=$(jq -r .version package.json)
  [src-tauri/Cargo.toml]=$(sed -n 's/^version = "\(.*\)"/\1/p' src-tauri/Cargo.toml | head -1)
  [packaging/arch/PKGBUILD]=$(sed -n 's/^pkgver=//p' packaging/arch/PKGBUILD)
  [packaging/arch-bin/PKGBUILD]=$(sed -n 's/^pkgver=//p' packaging/arch-bin/PKGBUILD)
)
for f in "${!versions[@]}"; do
  [ "${versions[$f]}" = "$ver" ] || die "version mismatch: tauri.conf.json=$ver but $f=${versions[$f]}"
done
echo "version $ver, targets: $targets"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "warning: uncommitted changes; packages are built from the working tree" >&2
fi

[ -d node_modules ] || npm ci

if [ "$run_tests" = 1 ]; then
  step "Tests"
  npx tsc --noEmit
  npx vitest run
  (cd src-tauri && cargo test --quiet)
fi

out="$ROOT/release/$ver"
rm -rf "$out"
mkdir -p "$out"

# ---------- deb (also the input for the Arch -bin package) ----------
if want deb || want arch; then
  step "Debian package"
  npx tauri build --bundles deb
  deb="src-tauri/target/release/bundle/deb/sonolith_${ver}_amd64.deb"
  [ -f "$deb" ] || die "expected $deb"
  want deb && cp "$deb" "$out/"
fi

# ---------- arch ----------
if want arch; then
  step "Arch package (sonolith-bin, makepkg + smoke test)"
  rm -f packaging/out/sonolith-bin-*.pkg.tar.zst
  restore_pkgbuilds=1 # on_exit restores the sha256sums make-src.sh writes
  packaging/arch/native-build.sh bin
  cp packaging/out/sonolith-bin-"$ver"-*-x86_64.pkg.tar.zst "$out/"
  git checkout -- packaging/arch/PKGBUILD packaging/arch-bin/PKGBUILD # clean tree again, e.g. for --publish
  restore_pkgbuilds=0
fi

# ---------- windows ----------
if want win; then
  step "Windows installer (NSIS via cargo-xwin)"
  npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis
  # NSIS names it after the product name (Sonolith_…); the release asset is lowercase like the others, and that's
  # the name update.rs downloads.
  exe="src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Sonolith_${ver}_x64-setup.exe"
  [ -f "$exe" ] || die "expected $exe"
  cp "$exe" "$out/sonolith_${ver}_x64-setup.exe"
fi

step "Checksums"
(cd "$out" && sha256sum -- * > SHA256SUMS)
ls -lh "$out"

if [ "$publish" = 1 ]; then
  step "Publish GitHub release"
  scripts/publish.sh "$ver"
fi
