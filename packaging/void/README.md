# Void Linux package

An `xbps-src` template for Sonolith on **x86_64 glibc** (`srcpkgs/sonolith/template`), meant to be submitted to
[void-packages](https://github.com/void-linux/void-packages). It is not in the official repository yet: until it
is, install from a local build (below). Once it is merged, users install it with `xbps-install -S sonolith`.

The template builds with cargo (`build_style=cargo`) and the frontend with npm in `pre_build`, and enables:

- `tauri/custom-protocol`: embeds the built frontend (what `tauri build` does);
- `system-ytdlp`: uses the `yt-dlp` package and never downloads or updates a copy of its own.

The installed app detects that xbps owns it, and its update dialog shows `xbps-install -Su sonolith` instead of a
download link. More background: [`docs/dev/packaging.md`](../../docs/dev/packaging.md).

## Dependencies and network access

`xbps-src` doesn't cut off the network during the build: templates with `build_style=cargo` let cargo download
crates in the build phase (cached in `hostdir/cargo`), and npm projects run `npm ci` / `pnpm install` / `yarn
install` in `pre_build` (for example `anubis`, `element-desktop`, `Signal-Desktop`). This template does the same,
locked by `Cargo.lock` and `package-lock.json`, so no vendor tarball is needed.

## Build and test locally

You need a clone of void-packages. On Void itself:

```sh
git clone https://github.com/void-linux/void-packages ~/void-packages
cd ~/void-packages
./xbps-src binary-bootstrap
cp -r /path/to/sonolith/packaging/void/srcpkgs/sonolith srcpkgs/
# fill in maintainer= first: xlint rejects the placeholder
xgensum -i sonolith                # fills in the checksum of the release tarball (from the xtools package)
xlint srcpkgs/sonolith/template
./xbps-src -j3 -Q pkg sonolith     # -Q runs the tests; -j3 keeps an 8 GB machine out of swap
sudo xbps-install --repository hostdir/binpkgs sonolith
```

On another distribution, build inside the official Void container instead. `xbps-src` then runs with the
`ethereal` chroot style, which installs build dependencies into the container itself, so only use a throwaway
container. `base-chroot`, what a real masterdir has, only lives in the bootstrap repository, so the command
installs `base-devel` plus the pieces of `base-chroot` the build hooks need (without `file`, stripping fails):

```sh
docker run --rm -e XBPS_CHROOT_CMD=ethereal -e XBPS_ALLOW_CHROOT_BREAKOUT=yes \
  -v ~/void-packages:/hostrepo ghcr.io/void-linux/void-glibc-full:latest /bin/sh -c '
    xbps-install -Syu xbps && xbps-install -Syu && xbps-install -y base-devel file bsdtar diffutils patch git xtools bash
    git config --global --add safe.directory /hostrepo
    echo x86_64 > /.xbps_chroot_init
    ln -sfn / /hostrepo/masterdir
    cd /hostrepo && ./xbps-src -j3 -Q pkg sonolith'
```

The files in `hostdir/` and `masterdir` are then owned by root; remove them from a container too
(`docker run --rm -v ~/void-packages:/w ghcr.io/void-linux/void-glibc-full:latest rm -rf /w/hostdir /w/masterdir`).

To test a commit that isn't released yet, put a tarball of it where `xbps-src` looks for the distfile and use its
checksum in your local copy of the template:

```sh
mkdir -p ~/void-packages/hostdir/sources/sonolith-<version>
git archive --prefix=sonolith-<version>/ HEAD | gzip -n > ~/void-packages/hostdir/sources/sonolith-<version>/v<version>.tar.gz
sha256sum ~/void-packages/hostdir/sources/sonolith-<version>/v<version>.tar.gz
```

Then check the result on Void (a real machine or VM, since the GUI needs a desktop session):

1. `xbps-install --repository hostdir/binpkgs sonolith` pulls in `yt-dlp`, `nodejs`, the GStreamer plugins and
   `libayatana-appindicator`.
2. `xbps-query -f sonolith` lists `/usr/bin/sonolith`, the desktop file, the icons and the license.
3. Start Sonolith from the application menu. Play a song; open Settings, System, yt-dlp, Details: it says yt-dlp
   comes from your system packages and shows the `/usr/bin/yt-dlp` version.
4. Sign in. Without a Secret Service provider (gnome-keyring, KeePassXC) on the D-Bus session bus, sign-in shows
   an error; Void doesn't start a session bus for every window manager (use `dbus-run-session` or your session's
   D-Bus setup).
5. Check the tray icon, media keys / MPRIS (`playerctl -l` lists `sonolith`) and the update dialog (it shows
   `xbps-install -Su sonolith` when a newer release exists).

## Submit to void-packages

Read Void's [package requirements](https://github.com/void-linux/void-packages/blob/master/CONTRIBUTING.md#package-requirements)
first: new packages need an established, mature release history, and should be submitted by someone other than
the software's developer.

1. Fork void-packages on GitHub and clone the fork; add the upstream remote.
2. `git checkout -b sonolith`
3. Copy `srcpkgs/sonolith/` from this directory. Set `version` to the release you package (the first release that
   has the `system-ytdlp` feature or later), fill in `maintainer` (`Name <email>`), and run `xgensum -i sonolith`.
4. `xlint srcpkgs/sonolith/template` must print nothing (it rejects the `NAME <EMAIL>` placeholder, so fill in
   the maintainer first).
5. Build with `-Q`, install it and test it at runtime (Void requires runtime testing of new packages).
6. Commit only `srcpkgs/sonolith/template` with the message `New package: sonolith-<version>`.
7. Push the branch to your fork and open a pull request against `void-linux/void-packages` `master`. Fill in the
   PR template: tested (yes), the architecture you built and ran it on (x86_64 glibc), and a short description.
   Say why x86_64 only (the packaged build and its testing are x86_64 glibc only) and why `nodejs` is a dependency
   (yt-dlp needs a JavaScript runtime for YouTube).

## Update on each release

1. `version=` to the new release, `revision=1`.
2. `xgensum -i sonolith` for the new tarball checksum.
3. Check whether `hostmakedepends`, `makedepends` or `depends` changed (new system libraries, a newer Node.js).
4. `xlint`, build with `-Q`, install and run it.
5. Commit as `sonolith: update to <version>.` and open a pull request.

A change to the template without a new version bumps `revision` instead and is committed as `sonolith: <reason>`.
