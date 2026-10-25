"""The queue (SPEC section 15 "Queue": `queue.get` with paging, `queue.add`, `queue.playNext`, `queue.move`,
`queue.remove`, `queue.clear`, `queue.setAutoplay`; section 16 `queue.changed`).

Entries are addressed by `entryId`, never by item id: the same song can be in the queue twice. `queue.changed`
carries only a summary, so the list is loaded again when it arrives.
"""

from __future__ import annotations

from ..lists import ItemList, Line, Row, item_text
from ..refs import PLAYABLE, parse_refs, ref_of
from .base import View, truncated_text

PAGE = 50


class QueueView(View):
    title = "Queue"
    scopes = ("queue:read",)
    keys = [
        ("Up / Down", "move the cursor"),
        ("a", "add items by id to the end (abc123, album:MPREb..., playlist:PL...)"),
        ("x", "add items by id to play next"),
        ("e", "add the selected entry again at the end"),
        ("d", "remove the selected entry"),
        ("K / J", "move the selected entry up / down"),
        ("C", "clear the queue (keeps what's playing)"),
        ("A", "autoplay on / off"),
        ("m", "load more"),
        ("r", "reload"),
    ]

    def __init__(self, app) -> None:
        super().__init__(app)
        self.list = ItemList()
        self.summary: dict = {}
        self.stale = False

    def on_show(self) -> None:
        if not self.list.loaded or self.stale:
            self.reload()

    def on_event(self, method: str, params: dict) -> None:
        if method == "queue.changed":
            if self.app.view is self:
                self.reload()
            else:
                self.stale = True

    def reload(self) -> None:
        self.stale = False
        keep = self.list.cursor
        self.list.loading = True

        def done(r: object) -> None:
            self.list.clear()
            self.list.loading = False
            self._take(r)
            self.list.cursor = keep
            self.list.move(0)

        self.app.call("queue.get", {"limit": PAGE}, done, on_error=self._failed)

    def _failed(self) -> None:
        self.list.loading = False

    def _take(self, r: object) -> None:
        if not isinstance(r, dict):
            return
        self.summary = {k: r.get(k) for k in ("revision", "currentIndex", "length", "autoplay")}
        current = r.get("currentIndex")
        for e in r.get("items") or []:
            if not isinstance(e, dict):
                continue
            mark = "* " if e.get("index") == current else ""
            auto = " (autoplay)" if e.get("autoplay") else ""
            self.list.add_row(Row(f"{e.get('index', 0) + 1:>3}. {mark}{item_text(e.get('item'))}{auto}", e.get("item"),
                                  e.get("entryId")))
        nc = r.get("nextCursor")
        self.list.next_cursor = nc if isinstance(nc, str) else None
        self.list.loaded = True

    def render(self, width: int, height: int) -> list[Line]:
        s = self.summary
        head = f"{s.get('length', 0)} entries, autoplay {'on' if s.get('autoplay') else 'off'}   (* = playing now)"
        return [(head, "bold")] + self.list.render(height - 1, "The queue is empty.")

    def on_key(self, key: str) -> bool:
        app, row = self.app, self.list.selected
        if key in ("KEY_UP", "k"):
            self.list.move(-1)
        elif key in ("KEY_DOWN", "j"):
            self.list.move(1)
        elif key == "KEY_PPAGE":
            self.list.move(-10)
        elif key == "KEY_NPAGE":
            self.list.move(10)
        elif key == "m":
            self._more()
        elif key == "r":
            self.reload()
        elif key in ("a", "x"):
            method = "queue.add" if key == "a" else "queue.playNext"
            app.ask("Item ids to add", lambda t: self._add(method, t))
        elif key == "e" and row and ref_of(row.item):
            app.call("queue.add", {"items": [ref_of(row.item)]}, lambda r: app.say(truncated_text(r, "Added.")))
        elif key == "d" and row and row.entry_id:
            app.call("queue.remove", {"entryIds": [row.entry_id]}, lambda r: app.say("Removed."))
        elif key in ("K", "J") and row and row.entry_id:
            index = self.list.cursor + (-1 if key == "K" else 1)
            if 0 <= index < int(self.summary.get("length") or 0):
                self.list.cursor = index
                app.call("queue.move", {"entryId": row.entry_id, "toIndex": index})
        elif key == "C":
            app.confirm("Clear the queue? What's playing now stays.", lambda: app.call("queue.clear", {}, lambda r: app.say("Cleared.")))
        elif key == "A":
            app.call("queue.setAutoplay", {"enabled": not self.summary.get("autoplay")})
        else:
            return False
        return True

    def _more(self) -> None:
        if not self.list.next_cursor or self.list.loading:
            return
        self.list.loading = True

        def done(r: object) -> None:
            self.list.loading = False
            self._take(r)

        self.app.call("queue.get", {"cursor": self.list.next_cursor, "limit": PAGE}, done, on_error=self._failed)

    def _add(self, method: str, text: str) -> None:
        refs, bad = parse_refs(text, PLAYABLE)
        if bad:
            self.app.say(f"Not an item id: {', '.join(bad)}. Use abc123, episode:..., album:..., playlist:... or podcast:...")
            return
        if refs:
            self.app.call(method, {"items": refs}, lambda r: self.app.say(truncated_text(r, f"Added {r.get('added') if isinstance(r, dict) else ''}.")))
