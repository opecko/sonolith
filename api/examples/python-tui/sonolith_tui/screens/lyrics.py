"""Live lyrics (SPEC section 15 `lyrics.get`, section 16 `lyrics.changed` and `lyrics.line`, section 17 "Lyrics":
tiers `word`, `line` and `unsynced`).

The current line and word come from the player position and the line and word timings, computed locally, so the
highlight moves smoothly between events; `lyrics.line` events correct the clock. The current word is shown in
[brackets] when the lyrics have word timings.
"""

from __future__ import annotations

from ..lists import Line
from .base import View

TIERS = {"word": "word by word", "line": "line by line", "unsynced": "not synced"}


def line_text(line: dict, word: int | None) -> str:
    """The line's text, with the current word in [brackets] when there are word timings."""
    words = line.get("words") or []
    if word is None or not words:
        return str(line.get("text") or "")
    parts = []
    for j, w in enumerate(words):
        t = str(w.get("text") or "")
        parts.append(f"[{t.strip()}]" + (" " if t.endswith(" ") else "") if j == word else t)
    return "".join(parts)


class LyricsView(View):
    title = "Lyrics"
    scopes = ("lyrics:read",)
    keys = [
        ("Up / Down", "move the cursor (stops following the song)"),
        ("Enter", "seek to the line under the cursor"),
        ("f", "follow the song again"),
        ("r", "load the lyrics again"),
    ]

    def __init__(self, app) -> None:
        super().__init__(app)
        self.cursor = 0
        self.follow = True
        self.top = 0

    def on_show(self) -> None:
        if self.app.store.lyrics is None:
            self._load()

    def on_event(self, method: str, params: dict) -> None:
        if method == "lyrics.changed":
            self.cursor = self.top = 0
            self.follow = True

    def _load(self) -> None:
        def done(r: object) -> None:
            if isinstance(r, dict):
                self.app.store.lyrics = r

        self.app.call("lyrics.get", {}, done)

    def render(self, width: int, height: int) -> list[Line]:
        st = self.app.store
        res = st.lyrics
        if res is None:
            return [("Loading lyrics...", "")]
        if res.get("status") == "instrumental":
            return [("This one is instrumental.", "")]
        lines = st.lyric_lines()
        if res.get("status") != "found" or not lines:
            return [("No lyrics found for this item.", "")]
        lyr = res.get("lyrics") or {}
        head = f"From {lyr.get('providerName') or lyr.get('provider')}, {TIERS.get(lyr.get('tier'), lyr.get('tier'))}"
        out: list[Line] = [(head, "bold")]
        if lyr.get("attribution"):
            out.append((str(lyr["attribution"]), ""))
        out.append(("Following the song." if self.follow else "Not following: press f to follow again.", ""))
        out.append(("", ""))
        current, word = st.current_lyric()
        if self.follow and current is not None:
            self.cursor = current
        self.cursor = max(0, min(self.cursor, len(lines) - 1))
        room = max(1, height - len(out))
        # Keep the cursor line a third of the way down.
        self.top = max(0, min(self.cursor - room // 3, len(lines) - room))
        for i in range(self.top, min(len(lines), self.top + room)):
            mark = ">>" if i == current else "  "
            text = line_text(lines[i], word if i == current else None)
            style = "reverse" if i == self.cursor and not self.follow else ("bold" if i == current else "")
            out.append((f"{mark} {text}", style))
        return out

    def on_key(self, key: str) -> bool:
        lines = self.app.store.lyric_lines()
        if key in ("KEY_UP", "k", "KEY_DOWN", "j"):
            self.follow = False
            self.cursor += -1 if key in ("KEY_UP", "k") else 1
            self.cursor = max(0, min(self.cursor, len(lines) - 1))
        elif key == "f":
            self.follow = True
        elif key == "r":
            self.app.store.lyrics = None
            self._load()
        elif key == "enter":
            start = lines[self.cursor].get("startMs") if 0 <= self.cursor < len(lines) else None
            if isinstance(start, int):
                self.follow = True
                self.app.call("player.seek", {"positionMs": start})
            else:
                self.app.say("These lyrics have no timings, so there is nothing to seek to.")
        else:
            return False
        return True
