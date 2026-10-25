"""What every screen shares: permission gating and the actions on a list item (SPEC section 8 "Scopes": use only
granted scopes; section 15 `player.playItem`, `queue.add`, `queue.playNext`, `browse.*`, `playlist.get`).

A screen names the scopes it needs. When none of them is granted it shows "Not allowed" and `P` asks Sonolith for
them with `app.requestScopes`, instead of calling and failing.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .. import scopes as sc
from ..lists import Line, Row
from ..refs import PLAYABLE, ref_of

if TYPE_CHECKING:
    from ..app import App

ITEM_KEYS = [
    ("Enter", "play a track or episode, open anything else"),
    ("p", "play the selected item (replaces the queue)"),
    ("e", "add it to the end of the queue"),
    ("x", "play it next"),
]


class View:
    title = ""
    scopes: tuple[str, ...] = ()  # any of these allows the screen
    keys: list[tuple[str, str]] = []

    def __init__(self, app: App) -> None:
        self.app = app

    def allowed(self) -> bool:
        return not self.scopes or any(s in self.app.store.granted for s in self.scopes)

    def missing(self) -> list[str]:
        return [s for s in self.scopes if s not in self.app.store.granted]

    def on_show(self) -> None:
        """The screen came into view (or the connection came up while it was in view)."""

    def on_event(self, method: str, params: dict) -> None:
        """An event from Sonolith, after the store has taken it in."""

    def on_key(self, key: str) -> bool:
        return False

    def render(self, width: int, height: int) -> list[Line]:
        return []

    def not_allowed(self) -> list[Line]:
        names = " or ".join(f"\"{sc.label(s)}\"" for s in self.scopes)
        return [
            ("Not allowed.", "bold"),
            ("", ""),
            (f"This screen needs the {names} permission, and Sonolith hasn't granted it to this app.", ""),
            ("Press P to ask for it. Sonolith shows you a request you can allow or decline.", ""),
        ]


def item_key(app: App, row: Row | None, key: str) -> bool:
    """The shared actions on a selected item. Returns True when the key was one of them."""
    if key not in ("enter", "p", "e", "x") or row is None or row.item is None:
        return False
    item = row.item
    ref = ref_of(item)
    if ref is None:
        app.say("This item has no id, so it can't be played.")
        return True
    kind = ref["type"]
    if key == "enter" and kind not in ("track", "episode"):
        open_item(app, item)
        return True
    if kind not in PLAYABLE:
        app.say("Artists can't be played or queued; press Enter to open the artist.")
        return True
    if key in ("enter", "p"):
        app.call("player.playItem", {"item": ref}, lambda r: app.say(truncated_text(r, "Playing.")))
    elif key == "e":
        app.call("queue.add", {"items": [ref]}, lambda r: app.say(truncated_text(r, "Added to the queue.")))
    else:
        app.call("queue.playNext", {"items": [ref]}, lambda r: app.say(truncated_text(r, "Plays next.")))
    return True


def truncated_text(result: object, ok: str) -> str:
    """`truncated` in a result means only the first `limit` items made it (SPEC `player.playItem`, `queue.add`)."""
    if isinstance(result, dict) and result.get("truncated"):
        return f"{ok} Only the first {result.get('limit')} items fit in the queue."
    return ok


def open_item(app: App, item: dict) -> None:
    from .browse import BrowseView, PlaylistView

    kind, ident = item.get("type"), item.get("id")
    if not isinstance(ident, str):
        return
    if kind == "playlist":
        app.push(PlaylistView(app, ident, str(item.get("title") or "")))
    elif kind in ("album", "artist", "podcast", "episode"):
        app.push(BrowseView(app, kind, ident))
