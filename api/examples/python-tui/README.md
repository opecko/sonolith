# Sonolith TUI

A plain-text terminal client that uses every part of Sonolith's local API: now playing with live progress, lyrics
that follow the song, the queue, your library and playlists, search, and a connection screen with the permissions
and a log of every call and event. It is the reference client: run it to see what Sonolith can do, read it to learn
how to integrate. Each module starts with a note saying which section of [SPEC.md](../../SPEC.md) it shows.

It needs only Python 3.10+ and its standard library (`curses`, `asyncio`): no packages, no colors.

## Run

Turn the API on first: Sonolith → Settings → Connected apps → **Let other apps connect to Sonolith**. Then, from this
folder:

```
python3 -m sonolith_tui
```

No virtualenv is needed. To run it from elsewhere, put this folder on `PYTHONPATH`
(fish: `env PYTHONPATH=api/examples/python-tui python3 -m sonolith_tui`, bash: `PYTHONPATH=api/examples/python-tui python3 -m sonolith_tui`).

## Connecting

The first start opens on screen **6 Connection**. Press `c`: Sonolith shows a notification and a dialog,
"Sonolith TUI wants to connect to Sonolith. It would like to: …", with one line per permission and the reason this
app gives for it. Only "See what's playing" is required; you can untick the rest. Then:

- **Allow**: the TUI stores its access in `~/.config/sonolith-tui/token` (readable only by you, mode 0600) and
  connects. Every later start connects by itself.
- **Not now**: the TUI shows how long until it may ask again (1 minute after the first "Not now", longer if you keep
  declining) and waits for you to press `c` again. Sonolith's Settings → Connected apps can lift the wait at once.
- **Block this app**: the TUI stops asking. Unblock it in Settings → Connected apps.

A screen that needs a permission you didn't grant shows "Not allowed"; press `P` there to ask for it.

If Sonolith isn't running, the TUI keeps trying again, waiting a little longer each time (up to a minute).

## Keys

`?` shows the keys of the current screen. Everywhere:

| Key | Does |
|---|---|
| `1`–`6` | Now playing, Lyrics, Queue, Library, Search, Connection |
| `Space` | play / pause |
| `Esc` | cancel the calls in flight, or go back from an opened album, artist, show or playlist |
| `q` | quit (the app stays allowed in Sonolith) |

In lists: arrows (or `j` / `k`) move, `Enter` plays a track or episode and opens anything else, `p` plays the
selected item, `e` adds it to the queue, `x` plays it next, `m` loads more. Now playing: `n` / `b` next / previous,
Left / Right seek, `g` go to a time, `+` / `-` volume, `m` mute, `s` shuffle, `r` repeat, `[` / `]` episode speed,
`l` / `d` like / dislike. Changes to your YouTube Music account (playlists) always ask `[y/N]` first.

## Removing it from Sonolith

Press `D` on the Connection screen ("Disconnect from Sonolith"): the TUI removes itself from Sonolith and deletes its
token. Or remove it in Sonolith: Settings → Connected apps → Sonolith TUI → **Remove app**; the TUI notices at once,
deletes its token and doesn't ask again until you press `c`.

## Tests

```
python3 -m unittest
```

Unit tests for the protocol client (framing, error messages, backoff, the token file's permissions) and tests that
drive the app with key presses against a small fake Sonolith (`tests/fake_server.py`): first registration, the
countdown after "Not now", a removal, a missing permission, queue and playlist changes with confirmation, and
disconnecting. They never touch a real account.

## Windows

Untested. Python on Windows has no `curses`; `pip install windows-curses` may provide it. The named pipe code
(`discovery.py`) follows the SPEC but has not been run.
