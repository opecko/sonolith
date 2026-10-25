"""The terminal: plain text through curses, no colors (not part of the API; see app.py for that).

Keys go to `App.key()` as names ("enter", "esc", "KEY_UP", "a", ...), and `App.render()` is painted about ten times
a second, so the progress bar, lyrics and countdowns move while nothing is pressed.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

try:
    import curses
except ImportError:  # pragma: no cover - Windows without the windows-curses package
    curses = None  # type: ignore[assignment]

from .app import App

SPECIAL = {"\n": "enter", "\r": "enter", "\x1b": "esc", "\x7f": "backspace", "\b": "backspace", "\t": "tab"}
NAMED = {"KEY_ENTER": "enter", "KEY_BACKSPACE": "backspace", "KEY_DC": "backspace", "KEY_BTAB": "KEY_BTAB"}


def key_name(ch: str | int) -> str | None:
    if isinstance(ch, str):
        return SPECIAL.get(ch, ch)
    name = curses.keyname(ch).decode("ascii", "replace")
    if name == "KEY_RESIZE":
        return None
    return NAMED.get(name, name)


def paint(screen, app: App) -> None:
    height, width = screen.getmaxyx()
    screen.erase()
    styles = {"": curses.A_NORMAL, "bold": curses.A_BOLD, "reverse": curses.A_REVERSE}
    for y, (text, style) in enumerate(app.render(width, height)):
        try:
            screen.addnstr(y, 0, text, max(0, width - 1), styles.get(style, curses.A_NORMAL))
        except curses.error:
            pass  # the last cell of the screen, or a window resized under us
    screen.refresh()


async def run(screen) -> None:
    curses.curs_set(0)
    screen.nodelay(True)
    screen.keypad(True)
    app = App()
    app.start()
    last = 0.0
    try:
        while not app.quit:
            pressed = False
            while True:
                try:
                    ch = screen.get_wch()
                except curses.error:
                    break
                name = key_name(ch)
                if name:
                    app.key(name)
                    pressed = True
            now = time.monotonic()
            if pressed or now - last > 0.1:
                paint(screen, app)
                last = now
            await asyncio.sleep(0.03)
    finally:
        await app.stop()


def main() -> None:
    if curses is None:
        sys.exit("This needs curses. On Windows: pip install windows-curses (untested).")
    os.environ.setdefault("ESCDELAY", "25")  # Esc reacts at once instead of after a second
    try:
        curses.wrapper(lambda screen: asyncio.run(run(screen)))
    except KeyboardInterrupt:
        pass
