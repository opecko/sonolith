"""Now playing (SPEC section 15 "Player" and `rating.set`, section 16 `player.stateChanged`, `player.trackChanged`,
`player.position`, `player.volumeChanged`, section 13.2 "Songs, music videos and podcasts").

The state comes from events, not polling: a snapshot after `events.subscribe`, then changes. The position is
extrapolated locally between `player.position` events (`positionMs + (now - positionAt) * rate`).
"""

from __future__ import annotations

from ..lists import Line
from ..state import EPISODE_RATES, REPEAT_MODES, fmt_ms, item_subtitle, item_title, parse_time
from .base import View


def progress_bar(pos: int, duration: int | None, width: int) -> str:
    """"1:23 [=====>-----] 3:45" in plain characters."""
    left, right = fmt_ms(pos), fmt_ms(duration)
    room = max(4, width - len(left) - len(right) - 4)
    if not duration:
        return f"{left} [{'-' * room}] {right}"
    done = min(room, int(room * pos / duration))
    bar = "=" * max(0, done - 1) + (">" if done else "") + "-" * (room - done)
    return f"{left} [{bar}] {right}"


class NowPlayingView(View):
    title = "Now playing"
    scopes = ("player:read",)
    keys = [
        ("Space", "play / pause"),
        ("n / b", "next / previous"),
        ("Left / Right", "seek 10 s back / forward"),
        ("g", "go to a time (1:23)"),
        ("+ / -", "volume up / down"),
        ("m", "mute / unmute"),
        ("s", "shuffle on / off"),
        ("r", "repeat: off, all, one"),
        ("[ / ]", "episode speed down / up"),
        ("l / d", "like / dislike (press again to clear)"),
    ]

    def render(self, width: int, height: int) -> list[Line]:
        st = self.app.store
        p = st.player
        if p is None:
            return [("Waiting for the player state...", "")]
        item = st.item
        lines: list[Line] = [(f"Status: {st.status}", "bold"), ("", "")]
        if item is None:
            lines.append(("Nothing is playing.", ""))
        else:
            lines.append((item_title(item), "bold"))
            sub = item_subtitle(item)
            if sub:
                lines.append((sub, ""))
            lines.append(("", ""))
            lines.append((progress_bar(st.position(), st.duration_ms, min(width, 80)), ""))
        lines.append(("", ""))
        vol = f"Volume {p.get('volume')}%" + (" (muted)" if p.get("muted") else "")
        lines.append((f"{vol}   Shuffle {'on' if p.get('shuffle') else 'off'}   Repeat {p.get('repeat', 'off')}", ""))
        if item and item.get("type") == "episode":
            lines.append((f"Episode speed {p.get('episodeRate', 1)}x", ""))
        if item and item.get("type") == "track":
            if "library:read" in st.granted:
                lines.append((f"Rating: {item.get('rating') or 'none'}", ""))
            else:
                lines.append(("Rating: hidden (needs \"Access your library\")", ""))
        if st.queue or p.get("queueLength"):
            idx = p.get("queueIndex")
            pos = f"{idx + 1} of {p.get('queueLength')}" if isinstance(idx, int) else f"{p.get('queueLength')} items"
            lines.append((f"Queue: {pos}, autoplay {'on' if p.get('autoplay') else 'off'}", ""))
        if st.signed_in is not None:
            lines.append((f"Signed in to YouTube: {'yes' if st.signed_in else 'no'}", ""))
        return lines

    def on_key(self, key: str) -> bool:
        app, p = self.app, self.app.store.player or {}
        if key == "n":
            app.call("player.next")
        elif key == "b":
            app.call("player.previous")
        elif key == "KEY_LEFT":
            app.call("player.seek", {"offsetMs": -10_000})
        elif key == "KEY_RIGHT":
            app.call("player.seek", {"offsetMs": 10_000})
        elif key == "g":
            app.ask("Go to (m:ss)", self._seek_to)
        elif key in ("+", "="):
            app.call("player.setVolume", {"volume": min(100, int(p.get("volume") or 0) + 5)})
        elif key == "-":
            app.call("player.setVolume", {"volume": max(0, int(p.get("volume") or 0) - 5)})
        elif key == "m":
            app.call("player.setVolume", {"muted": not p.get("muted")})
        elif key == "s":
            app.call("player.setShuffle", {"enabled": not p.get("shuffle")})
        elif key == "r":
            mode = p.get("repeat") if p.get("repeat") in REPEAT_MODES else "off"
            app.call("player.setRepeat", {"mode": REPEAT_MODES[(REPEAT_MODES.index(mode) + 1) % len(REPEAT_MODES)]})
        elif key in ("[", "]"):
            self._speed(-1 if key == "[" else 1)
        elif key in ("l", "d"):
            self._rate("like" if key == "l" else "dislike")
        else:
            return False
        return True

    def _seek_to(self, text: str) -> None:
        ms = parse_time(text)
        if ms is None:
            self.app.say("Type a time like 1:23 or 83.")
        else:
            self.app.call("player.seek", {"positionMs": ms})

    def _speed(self, step: int) -> None:
        item = self.app.store.item
        if not item or item.get("type") != "episode":
            self.app.say("Speed applies to podcast episodes only.")
            return
        rate = (self.app.store.player or {}).get("episodeRate", 1)
        i = EPISODE_RATES.index(rate) if rate in EPISODE_RATES else EPISODE_RATES.index(1)
        i = max(0, min(len(EPISODE_RATES) - 1, i + step))
        self.app.call("player.setRate", {"rate": EPISODE_RATES[i]})

    def _rate(self, rating: str) -> None:
        item = self.app.store.item
        if not item or not isinstance(item.get("id"), str):
            self.app.say("Nothing is playing.")
            return
        new = "none" if item.get("rating") == rating else rating
        word = {"like": "Liked.", "dislike": "Disliked.", "none": "Rating cleared."}[new]
        self.app.call("rating.set", {"item": {"type": item["type"], "id": item["id"]}, "rating": new},
                      lambda _r: self.app.say(word))
