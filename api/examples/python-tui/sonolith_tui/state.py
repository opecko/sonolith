"""The app's view of Sonolith, built from events (SPEC section 10 "Events", section 16 "Event reference", section 13
"Data model").

The store never polls. After `events.subscribe`, Sonolith sends a snapshot per topic and then changes; `apply()`
folds each event in and says what changed, so the UI redraws only what it must. Positions are extrapolated between
`player.position` events: `positionMs + (now - positionAt) * rate` while playing (section 16, `player.position`).
Every field the schema defines is present, but this code still reads defensively and never raises on odd shapes.
"""

from __future__ import annotations

import bisect
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------- pure helpers


def extrapolate(position_ms: int, position_at: int, rate: float, status: str, duration_ms: int | None, now: int) -> int:
    """The position now. Only moves while playing; never past the item's length."""
    pos = position_ms
    if status == "playing":
        pos = position_ms + int(max(0, now - position_at) * (rate or 1))
    if duration_ms is not None:
        pos = min(pos, duration_ms)
    return max(0, pos)


def locate_lyrics(lines: list[dict], pos: int) -> tuple[int | None, int | None]:
    """The line being sung at `pos`, and the word in it (when the line has word timings).

    A line lasts from its `startMs` to its `endMs`, or to the next line's start when `endMs` is null. Before the
    first line and in gaps the line is None. Unsynced lyrics (null starts) have no current line.
    """
    starts = [line.get("startMs") for line in lines]
    if not starts or any(not isinstance(s, int) for s in starts):
        return None, None
    i = bisect.bisect_right(starts, pos) - 1
    if i < 0:
        return None, None
    line = lines[i]
    end = line.get("endMs")
    if not isinstance(end, int):
        end = starts[i + 1] if i + 1 < len(starts) else None
    if end is not None and pos >= end:
        return None, None
    words = line.get("words") or []
    word = None
    for j, w in enumerate(words):
        ws, we = w.get("startMs"), w.get("endMs")
        if isinstance(ws, int) and ws <= pos and (not isinstance(we, int) or pos < we):
            word = j
        elif isinstance(ws, int) and ws > pos:
            break
    return i, word


def artists_text(item: dict | None) -> str:
    if not item:
        return ""
    names = [a.get("name", "") for a in item.get("artists") or [] if isinstance(a, dict)]
    return ", ".join(n for n in names if n)


def item_title(item: dict | None) -> str:
    if not item:
        return ""
    return str(item.get("title") or item.get("name") or item.get("id") or "")


def item_subtitle(item: dict | None) -> str:
    """Artist and album for a track, the show for an episode, the author for a playlist (section 13.2)."""
    if not item:
        return ""
    kind = item.get("type")
    if kind == "episode":
        show = (item.get("podcast") or {}).get("title") if isinstance(item.get("podcast"), dict) else None
        return " · ".join(x for x in (show, item.get("author"), item.get("publishedText")) if x)
    if kind == "track":
        album = (item.get("album") or {}).get("title") if isinstance(item.get("album"), dict) else None
        return " · ".join(x for x in (artists_text(item), album, "video" if item.get("video") else None) if x)
    if kind == "album":
        return " · ".join(str(x) for x in (artists_text(item), item.get("albumType"), item.get("year")) if x)
    if kind == "playlist":
        count = item.get("trackCount")
        return " · ".join(str(x) for x in (item.get("author"), f"{count} items" if count is not None else None) if x)
    if kind == "artist":
        return str(item.get("subscribersText") or "")
    if kind == "podcast":
        return str(item.get("author") or "")
    return ""


def fmt_ms(ms: int | None) -> str:
    if ms is None:
        return "--:--"
    s = max(0, int(ms)) // 1000
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def parse_time(text: str) -> int | None:
    """"1:23", "83", "1:02:03" -> milliseconds; None when it isn't a time."""
    parts = text.strip().split(":")
    if not parts or len(parts) > 3 or any(not p.strip().isdigit() for p in parts):
        return None
    total = 0
    for p in parts:
        total = total * 60 + int(p)
    return total * 1000


# ---------------------------------------------------------------- the store


@dataclass
class LogEntry:
    at: float
    direction: str  # "->" request, "<-" answer or event, "!!" problem, "--" state
    what: str
    details: str


EPISODE_RATES = (0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3)
REPEAT_MODES = ("off", "all", "one")


@dataclass
class Store:
    granted: frozenset[str] = frozenset()
    signed_in: bool | None = None
    player: dict[str, Any] | None = None
    position_ms: int = 0
    position_at: int = 0
    queue: dict[str, Any] | None = None  # QueueSummary
    lyrics: dict[str, Any] | None = None  # LyricsResult
    lyrics_line: int | None = None  # from `lyrics.line`, used to correct the local clock
    log: deque = field(default_factory=lambda: deque(maxlen=400))

    # ------------------------------------------------------------ events

    def apply(self, method: str, params: dict) -> set[str]:
        """Folds one event in; returns the parts that changed: player, position, volume, queue, lyrics, scopes,
        account."""
        if method == "player.stateChanged":
            self.player = dict(params)
            self._take_position(params)
            return {"player", "position", "volume"}
        if method == "player.trackChanged":
            item = params.get("item")
            if self.player is None:
                self.player = {"status": "stopped", "item": item}
            else:
                self.player = {**self.player, "item": item}
            return {"player"}
        if method == "player.position":
            self._take_position(params)
            if self.player is not None:
                for k in ("status", "durationMs", "rate"):
                    if k in params:
                        self.player[k] = params[k]
            return {"position"}
        if method == "player.volumeChanged":
            if self.player is not None:
                self.player = {**self.player, "volume": params.get("volume"), "muted": params.get("muted")}
            return {"volume"}
        if method == "queue.changed":
            self.queue = {k: params.get(k) for k in ("revision", "currentIndex", "length", "autoplay")}
            if self.player is not None and isinstance(params.get("autoplay"), bool):
                self.player = {**self.player, "autoplay": params["autoplay"]}
            return {"queue"}
        if method == "lyrics.changed":
            self.lyrics = dict(params)
            self.lyrics_line = None
            return {"lyrics"}
        if method == "lyrics.line":
            idx = params.get("lineIndex")
            self.lyrics_line = idx if isinstance(idx, int) else None
            if isinstance(params.get("positionMs"), int):
                # The line event carries the position it was sent at: a free correction of the local clock.
                self.position_ms = params["positionMs"]
                self.position_at = now_ms()
            return {"lyrics_line"}
        if method == "account.changed":
            self.signed_in = bool(params.get("signedIn"))
            return {"account"}
        if method == "session.scopesChanged":
            scopes = params.get("grantedScopes")
            if isinstance(scopes, list):
                self.granted = frozenset(s for s in scopes if isinstance(s, str))
            return {"scopes"}
        return set()

    def _take_position(self, params: dict) -> None:
        if isinstance(params.get("positionMs"), int):
            self.position_ms = params["positionMs"]
            at = params.get("positionAt")
            self.position_at = at if isinstance(at, int) else now_ms()

    def reset_live(self) -> None:
        """Forget everything that came from events (after a disconnect): the next snapshots bring it back."""
        self.player = None
        self.queue = None
        self.lyrics = None
        self.lyrics_line = None

    # ------------------------------------------------------------ derived values

    @property
    def item(self) -> dict | None:
        item = (self.player or {}).get("item")
        return item if isinstance(item, dict) else None

    @property
    def status(self) -> str:
        return str((self.player or {}).get("status") or "stopped")

    @property
    def duration_ms(self) -> int | None:
        d = (self.player or {}).get("durationMs")
        return d if isinstance(d, int) else None

    def position(self, now: int | None = None) -> int:
        rate = (self.player or {}).get("rate") or 1
        return extrapolate(self.position_ms, self.position_at, float(rate), self.status, self.duration_ms, now or now_ms())

    def lyric_lines(self) -> list[dict]:
        lyr = (self.lyrics or {}).get("lyrics")
        if not isinstance(lyr, dict):
            return []
        lines = lyr.get("lines")
        return [l for l in lines if isinstance(l, dict)] if isinstance(lines, list) else []

    def current_lyric(self, now: int | None = None) -> tuple[int | None, int | None]:
        if self.status != "playing" and self.status != "paused":
            return None, None
        return locate_lyrics(self.lyric_lines(), self.position(now))

    def add_log(self, direction: str, what: str, details: Any) -> None:
        text = details if isinstance(details, str) else _short(details)
        self.log.append(LogEntry(time.time(), direction, what, text))


def _short(value: Any, limit: int = 160) -> str:
    try:
        import json

        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        text = repr(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"
