"""The user's library (SPEC section 15 "Library": `library.playlists`, `library.likedSongs`, `library.albums`,
`library.artists`, `library.podcasts`, `library.episodesForLater`, `library.history`, all paged with cursors; and
"Playlists": `playlist.create`, `playlist.rename`, `playlist.delete`).

Every change to the user's account asks for confirmation first.
"""

from __future__ import annotations

from ..lists import ItemList, Line, Row, item_text
from .base import ITEM_KEYS, View, item_key

PAGE = 50
KINDS = [
    ("library.playlists", "Playlists"),
    ("library.likedSongs", "Liked songs"),
    ("library.albums", "Albums"),
    ("library.artists", "Artists"),
    ("library.podcasts", "Podcasts"),
    ("library.episodesForLater", "Episodes for later"),
    ("library.history", "History"),
]


class LibraryView(View):
    title = "Library"
    scopes = ("library:read",)
    keys = [
        ("Left / Right, Tab", "switch between playlists, liked songs, albums, ..."),
        ("Up / Down", "move the cursor"),
        *ITEM_KEYS,
        ("m", "load more"),
        ("r", "reload"),
        ("c", "Playlists: create a playlist"),
        ("R", "Playlists: rename the selected playlist"),
        ("X", "Playlists: delete the selected playlist"),
    ]

    def __init__(self, app) -> None:
        super().__init__(app)
        self.kind = 0
        self.lists = {method: ItemList() for method, _ in KINDS}

    @property
    def method(self) -> str:
        return KINDS[self.kind][0]

    @property
    def list(self) -> ItemList:
        return self.lists[self.method]

    def on_show(self) -> None:
        if not self.list.loaded and not self.list.loading:
            self.load()

    def load(self, more: bool = False) -> None:
        lst, method = self.list, self.method
        if lst.loading or (more and not lst.next_cursor):
            return
        params: dict = {"limit": PAGE}
        if more:
            params["cursor"] = lst.next_cursor
        else:
            lst.clear()
        lst.loading = True

        def done(r: object) -> None:
            lst.loading = False
            if isinstance(r, dict):
                if method == "library.history":
                    self._history(lst, r)
                else:
                    lst.add_items(r.get("items") or [], r.get("nextCursor"))

        def failed() -> None:
            lst.loading = False

        self.app.call(method, params, done, on_error=failed)

    @staticmethod
    def _history(lst: ItemList, r: dict) -> None:
        """History entries come with a section ("Today", "Yesterday"): shown as headers."""
        last = lst.rows[-1].text if lst.rows else None
        for e in r.get("items") or []:
            if not isinstance(e, dict):
                continue
            section = e.get("sectionText")
            if section and section != last:
                lst.add_row(Row(str(section), selectable=False))
                last = section
            lst.add_row(Row(item_text(e.get("item")), e.get("item")))
        nc = r.get("nextCursor")
        lst.next_cursor = nc if isinstance(nc, str) else None
        lst.loaded = True

    def render(self, width: int, height: int) -> list[Line]:
        tabs = "  ".join(f"[{name}]" if i == self.kind else name for i, (_, name) in enumerate(KINDS))
        return [(tabs, "bold"), ("", "")] + self.list.render(height - 2)

    def on_key(self, key: str) -> bool:
        lst, app = self.list, self.app
        if key in ("KEY_RIGHT", "tab", "KEY_LEFT", "KEY_BTAB"):
            self.kind = (self.kind + (-1 if key in ("KEY_LEFT", "KEY_BTAB") else 1)) % len(KINDS)
            self.on_show()
        elif key in ("KEY_UP", "k"):
            lst.move(-1)
        elif key in ("KEY_DOWN", "j"):
            lst.move(1)
        elif key == "KEY_PPAGE":
            lst.move(-10)
        elif key == "KEY_NPAGE":
            lst.move(10)
        elif key == "m":
            self.load(more=True)
        elif key == "r":
            self.load()
        elif key in ("c", "R", "X"):
            self._playlist_key(key)
        else:
            return item_key(app, lst.selected, key)
        return True

    def _playlist_key(self, key: str) -> None:
        app = self.app
        if self.method != "library.playlists":
            app.say("Switch to Playlists first (Left / Right).")
            return
        if key == "c":
            app.ask("New playlist title", self._create)
            return
        row = self.list.selected
        item = row.item if row else None
        if not item:
            return
        pid, title = item.get("id"), item.get("title")
        if key == "R":
            app.ask(f"New title for \"{title}\"", lambda t: self._rename(pid, title, t), initial=str(title or ""))
        else:
            app.confirm(f"Delete the playlist \"{title}\" from your YouTube Music account? This can't be undone.",
                        lambda: app.call("playlist.delete", {"id": pid}, lambda _r: self._changed("Deleted.")))

    def _rename(self, pid: str, old: str, text: str) -> None:
        title = text.strip()
        if not title or title == old:
            return
        self.app.confirm(f"Rename \"{old}\" to \"{title}\" in your YouTube Music library?",
                         lambda: self.app.call("playlist.rename", {"id": pid, "title": title},
                                               lambda _r: self._changed("Renamed.")))

    def _create(self, text: str) -> None:
        title = text.strip()
        if not title:
            return
        self.app.confirm(f"Create a private playlist \"{title}\" in your YouTube Music library?",
                         lambda: self.app.call("playlist.create", {"title": title, "privacy": "private"},
                                               lambda _r: self._changed("Created.")))

    def _changed(self, text: str) -> None:
        # YouTube's library listing lags behind edits, so a reload may not show the change at once.
        self.app.say(text + " The library list can take a moment to catch up; press r to reload.")
        self.load()
