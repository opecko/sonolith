## Smoother and lighter

A polish release: animations no longer flicker, and ytdesk does less work in the background.

### Smoother animations

- **Now Playing opens and closes cleanly.** It slides out from behind the player bar and back down when you close
  it. It no longer covers the player controls on the way up, and it no longer flashes for a frame when the
  animation ends.
- **The ambient light in Now Playing doesn't blink** when it fades in.
- **Settings switches slide smoothly**, and their colors change together with the knob.

### Lighter on your computer

- **Smaller thumbnails in lists.** Song rows, the queue and search results load cover art at the size they
  show it, instead of images up to 10× larger. Long playlists use much less memory and scroll more easily. Big
  covers (Now Playing, desktop media controls, Discord) keep their full quality.
- **Fewer redraws.** Play and pause no longer redraw the whole queue, and dragging the Appearance sliders no
  longer recalculates every color on each mouse movement.
- **Less work while hidden.** Podcast video stops decoding while the window is hidden in the tray, because the
  audio plays on its own.
- **Discord Rich Presence when Discord isn't running:** ytdesk no longer tries hundreds of connections every few
  seconds, and it stays idle when there's nothing to send. It still connects as soon as you start Discord.
- **No more stalls from the keyring.** Reading your login and settings no longer blocks the app, even when the
  keyring is slow to unlock.

### Fixed

- **Listening history.** Songs that played entirely while ytdesk was hidden in the tray are now added to your
  YouTube Music history.

## Changes

- Now Playing: slide out from behind the player bar without a first-frame flash, and slide back down when closing
- Now Playing: drive the slide and the ambient fade-in from requestAnimationFrame; WebKitGTK flashed the pre-animation state for a frame when a CSS animation ended
- Switches: move the knob with left and fade the colors along with it; no compositor transform that WebKitGTK flashes at the end
- Performance: queue rows skip re-render on play/pause, appearance drags don't recompute every token or write storage per move, slot-sized list thumbnails, muted podcast video pauses while hidden; history counts plays while the window is hidden
- Performance: Discord probes only existing socket dirs and sleeps when nothing is pending, keyring/config reads off the async runtime, I/O commands off the GTK thread, proxy backs off on accept errors

**Full diff:** [`v1.2.0...v1.2.1`](https://github.com/opecko/ytdesk/compare/v1.2.0...v1.2.1)

## Downloads

| Platform | File |
| --- | --- |
| Windows 10/11 (x64) | `ytdesk_*_x64-setup.exe` |
| Debian / Ubuntu 24.04+ | `ytdesk_*_amd64.deb` |
| Arch Linux | `ytdesk-bin-*-x86_64.pkg.tar.zst` (`sudo pacman -U <file>`) |

Checksums are in `SHA256SUMS`.

