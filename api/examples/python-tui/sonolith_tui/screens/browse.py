"""Opened items (SPEC section 15 "Browse": `browse.album`, `browse.artist`, `browse.podcast` (paged),
`browse.episode`; "Playlists": `playlist.get` (paged), `playlist.addTracks`, `playlist.removeTracks`,
`playlist.rename`, `playlist.delete`).

These screens open on top of a tab; Esc goes back. Playlist entries are removed by `entryId`, one at a time, so of a
song that is in the playlist twice only the selected copy goes. Every change to the account asks first.
"""

from __future__ import annotations

import textwrap

from ..lists import ItemList, Line, Row, item_text
from ..refs import MEDIA, parse_refs
from ..state import fmt_ms, item_subtitle, item_title
from .base import ITEM_KEYS, View, item_key

PAGE = 50
LIST_KEYS = [("Up / Down", "move the cursor"), *ITEM_KEYS, ("m", "load more"), ("Esc", "back")]


def wrap(text: object, width: int, limit: int = 6) -> list[Line]:
    if not text:
        return []
    lines = textwrap.wrap(str(text), max(20, width - 2))
    if len(lines) > limit:
        lines = lines[:limit] + ["..."]
    return [(l, "") for l in lines]


class BrowseView(View):
    """An album, artist, podcast show or episode page."""

    scopes = ("search",)
    keys = LIST_KEYS

    def __init__(self, app, kind: str, ident: str) -> None:
        super().__init__(app)
        self.kind = kind
        self.ident = ident
        self.title = kind.capitalize()
        self.detail: dict | None = None
        self.list = ItemList()
        self.list.loading = True
        app.call(f"browse.{kind}", {"id": ident}, self._take, on_error=self._failed)

    def _failed(self) -> None:
        self.list.loading = False

    def _take(self, r: object) -> None:
        self.list.loading = False
        if not isinstance(r, dict):
            return
        if self.kind == "album":
            self.detail = r
            self.list.add_items(r.get("tracks") or [])
        elif self.kind == "artist":
            self.detail = r
            for section in r.get("sections") or []:
                if isinstance(section, dict) and section.get("items"):
                    self.list.add_row(Row(str(section.get("title") or section.get("kind")), selectable=False))
                    self.list.add_items(section["items"])
            self.list.loaded = True
        elif self.kind == "podcast":
            self.detail = r.get("podcast") if isinstance(r.get("podcast"), dict) else self.detail
            self.list.add_items(r.get("items") or [], r.get("nextCursor"))
        else:  # episode
            self.detail = r
            self.list.add_items([r])

    def render(self, width: int, height: int) -> list[Line]:
        d = self.detail or {}
        out: list[Line] = []
        if d:
            out.append((item_title(d), "bold"))
            sub = item_subtitle(d)
            if self.kind == "album" and d.get("trackCount"):
                sub += f" - {d['trackCount']} tracks, {fmt_ms(d.get('durationMs'))}"
            if sub:
                out.append((sub, ""))
            out += wrap(d.get("description"), width)
            out.append(("", ""))
        return out + self.list.render(height - len(out))

    def on_key(self, key: str) -> bool:
        if key in ("KEY_UP", "k"):
            self.list.move(-1)
        elif key in ("KEY_DOWN", "j"):
            self.list.move(1)
        elif key == "KEY_PPAGE":
            self.list.move(-10)
        elif key == "KEY_NPAGE":
            self.list.move(10)
        elif key == "m" and self.kind == "podcast" and self.list.next_cursor and not self.list.loading:
            self.list.loading = True
            self.app.call("browse.podcast", {"id": self.ident, "cursor": self.list.next_cursor, "limit": PAGE},
                          self._take, on_error=self._failed)
        elif key == "P" and self.kind in ("album", "podcast"):
            self.app.call("player.playItem", {"item": {"type": self.kind, "id": self.ident}}, lambda _r: self.app.say("Playing."))
        else:
            return item_key(self.app, self.list.selected, key)
        return True


class PlaylistView(View):
    """A playlist with its entries; the user's own playlists can be edited."""

    title = "Playlist"
    scopes = ("library:read", "search")
    keys = [
        ("Up / Down", "move the cursor"),
        ("Enter", "play the playlist from the selected entry"),
        ("P", "play the whole playlist"),
        ("e / x", "add the selected entry to the queue / play it next"),
        ("a", "add tracks by id (abc123, episode:...)"),
        ("d", "remove the selected entry (only this copy)"),
        ("R", "rename the playlist"),
        ("X", "delete the playlist"),
        ("m", "load more"),
        ("Esc", "back"),
    ]

    def __init__(self, app, ident: str, title: str = "") -> None:
        super().__init__(app)
        self.ident = ident
        self.name = title
        self.info: dict = {}
        self.list = ItemList()
        self.load()

    def load(self, more: bool = False) -> None:
        lst = self.list
        if lst.loading or (more and not lst.next_cursor):
            return
        params: dict = {"id": self.ident, "limit": PAGE}
        if more:
            params["cursor"] = lst.next_cursor
        else:
            lst.clear()
        lst.loading = True
        self.app.call("playlist.get", params, self._take, on_error=self._failed)

    def _failed(self) -> None:
        self.list.loading = False

    def _take(self, r: object) -> None:
        self.list.loading = False
        if not isinstance(r, dict):
            return
        if isinstance(r.get("playlist"), dict):
            self.info = r["playlist"]
            self.name = str(self.info.get("title") or self.name)
        for e in r.get("items") or []:
            if isinstance(e, dict):
                self.list.add_row(Row(item_text(e.get("item")), e.get("item"), e.get("entryId")))
        nc = r.get("nextCursor")
        self.list.next_cursor = nc if isinstance(nc, str) else None
        self.list.loaded = True

    def render(self, width: int, height: int) -> list[Line]:
        i = self.info
        out: list[Line] = [(self.name or "Playlist", "bold")]
        bits = [item_subtitle(i), i.get("privacy"), "yours, can be edited" if i.get("editable") else "can't be edited"]
        out.append((" - ".join(str(b) for b in bits if b), ""))
        out += wrap(i.get("description"), width, 3)
        out.append(("", ""))
        return out + self.list.render(height - len(out), "This playlist is empty.")

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
            self.load(more=True)
        elif key == "P" or (key == "enter" and row and row.item):
            params: dict = {"item": {"type": "playlist", "id": self.ident}}
            if key == "enter" and isinstance(row.item.get("id"), str):
                params["startId"] = row.item["id"]
            app.call("player.playItem", params, lambda _r: app.say("Playing the playlist."))
        elif key == "a":
            app.ask("Track ids to add", self._add)
        elif key == "d" and row:
            self._remove(row)
        elif key == "R":
            app.ask("New title", self._rename, initial=self.name)
        elif key == "X":
            app.confirm(f"Delete the playlist \"{self.name}\" from your YouTube Music account? This can't be undone.",
                        lambda: app.call("playlist.delete", {"id": self.ident}, lambda _r: self._deleted()))
        else:
            return item_key(app, row, key) if key in ("e", "x") else False
        return True

    def _add(self, text: str) -> None:
        refs, bad = parse_refs(text, MEDIA)
        if bad:
            self.app.say(f"Not a track or episode id: {', '.join(bad)}.")
            return
        if refs:
            self.app.confirm(f"Add {len(refs)} item(s) to \"{self.name}\" in your YouTube Music library?",
                             lambda: self.app.call("playlist.addTracks", {"id": self.ident, "items": refs}, self._added))

    def _added(self, r: object) -> None:
        if isinstance(r, dict):
            skipped = f", {r.get('skipped')} already there" if r.get("skipped") else ""
            self.app.say(f"Added {r.get('added')}{skipped}.")
        self.load()

    def _remove(self, row: Row) -> None:
        if not row.entry_id:
            self.app.say("This entry can't be removed (it has no entry id).")
            return
        title = item_title(row.item)
        self.app.confirm(f"Remove \"{title}\" from \"{self.name}\"? Only this copy goes.",
                         lambda: self.app.call("playlist.removeTracks", {"id": self.ident, "entryIds": [row.entry_id]},
                                               lambda _r: self._removed(row)))

    def _removed(self, row: Row) -> None:
        if row in self.list.rows:
            self.list.rows.remove(row)
            self.list.move(0)
        self.app.say("Removed.")

    def _rename(self, text: str) -> None:
        title = text.strip()
        if title and title != self.name:
            self.app.confirm(f"Rename \"{self.name}\" to \"{title}\" in your YouTube Music library?",
                             lambda: self.app.call("playlist.rename", {"id": self.ident, "title": title},
                                                   lambda _r: self._renamed(title)))

    def _renamed(self, title: str) -> None:
        self.name = title
        self.app.say("Renamed.")

    def _deleted(self) -> None:
        self.app.say("Deleted.")
        self.app.pop()
