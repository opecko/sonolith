"""Search (SPEC section 15 "Search": `search.query` with a type filter and paging, `search.suggestions`).

While you type the query, suggestions arrive (one call at a time; a newer keystroke cancels the older call) and Tab
puts them into the line. Results open with Enter like everywhere else: albums, artists, shows and episodes through
`browse.*`, playlists through `playlist.get`.
"""

from __future__ import annotations

import asyncio

from ..lists import ItemList, Line, Row, item_text
from .base import ITEM_KEYS, View, item_key

PAGE = 30
TYPES = ("all", "songs", "videos", "albums", "artists", "playlists", "podcasts", "episodes")


class SearchView(View):
    title = "Search"
    scopes = ("search",)
    keys = [
        ("/ or s", "type a search (Tab takes a suggestion)"),
        ("t", "change the type: all, songs, videos, albums, ..."),
        ("Up / Down", "move the cursor"),
        *ITEM_KEYS,
        ("m", "load more"),
    ]

    def __init__(self, app) -> None:
        super().__init__(app)
        self.query = ""
        self.type = 0
        self.list = ItemList()
        self._suggest: asyncio.Task | None = None

    def on_show(self) -> None:
        if not self.query:
            self.edit()

    def edit(self) -> None:
        self.app.ask("Search", self.search, initial=self.query, on_change=self.suggest)

    def suggest(self, text: str) -> None:
        if self._suggest is not None:
            self._suggest.cancel()
        prompt = self.app.prompt
        if prompt is None or len(text.strip()) < 2:
            return

        def done(r: object) -> None:
            if isinstance(r, dict) and self.app.prompt is prompt:
                prompt.completions = [q for q in r.get("queries") or [] if isinstance(q, str)]

        self._suggest = self.app.call("search.suggestions", {"query": text}, done, quiet=True, delay=0.3)

    def search(self, text: str, more: bool = False) -> None:
        if not more:
            self.query = text.strip()
            self.list.clear()
        if not self.query:
            return
        params: dict = {"query": self.query, "type": TYPES[self.type], "limit": PAGE}
        if more:
            if not self.list.next_cursor or self.list.loading:
                return
            params["cursor"] = self.list.next_cursor
        self.list.loading = True

        def done(r: object) -> None:
            self.list.loading = False
            if not isinstance(r, dict):
                return
            if not more and isinstance(r.get("topResult"), dict):
                self.list.add_row(Row("Top result", selectable=False))
                self.list.add_row(Row(item_text(r["topResult"]), r["topResult"]))
                self.list.add_row(Row("Results", selectable=False))
            self.list.add_items(r.get("items") or [], r.get("nextCursor"))

        def failed() -> None:
            self.list.loading = False

        self.app.call("search.query", params, done, on_error=failed)

    def render(self, width: int, height: int) -> list[Line]:
        types = "  ".join(f"[{t}]" if i == self.type else t for i, t in enumerate(TYPES))
        out: list[Line] = [(f"Search: {self.query or '(press / to type)'}", "bold"), (f"Type: {types}", ""), ("", "")]
        p = self.app.prompt
        if p is not None and p.completions:
            out.append(("Suggestions (Tab):", "bold"))
            out += [(f"  {q}", "") for q in p.completions[:8]]
            out.append(("", ""))
        return out + self.list.render(height - len(out), "No results." if self.query else "")

    def on_key(self, key: str) -> bool:
        if key in ("/", "s"):
            self.edit()
        elif key == "t":
            self.type = (self.type + 1) % len(TYPES)
            self.search(self.query)
        elif key in ("KEY_UP", "k"):
            self.list.move(-1)
        elif key in ("KEY_DOWN", "j"):
            self.list.move(1)
        elif key == "KEY_PPAGE":
            self.list.move(-10)
        elif key == "KEY_NPAGE":
            self.list.move(10)
        elif key == "m":
            self.search(self.query, more=True)
        else:
            return item_key(self.app, self.list.selected, key)
        return True
