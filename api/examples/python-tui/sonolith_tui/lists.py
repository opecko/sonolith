"""A scrolling list with a cursor and cursor-based paging (SPEC section 13.6 "Pagination").

Lists come one page at a time: a result has `items` and `nextCursor`; pass the cursor back to get the next page, and
stop when it is null. `ItemList` keeps the rows loaded so far and the cursor for "load more". Pure: no I/O.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .state import fmt_ms, item_subtitle, item_title

Line = tuple[str, str]  # (text, style): style is "" , "bold" or "reverse"


@dataclass
class Row:
    text: str
    item: dict | None = None
    entry_id: str | None = None  # queue and playlist entries: what remove and move take (SPEC 13.1)
    selectable: bool = True


def item_text(item: dict | None) -> str:
    """One line for an item: "[album] Title - Artist - 2020   3:45"."""
    if not isinstance(item, dict):
        return "(unknown item)"
    kind = item.get("type") or "?"
    sub = item_subtitle(item)
    dur = item.get("durationMs")
    tail = f"   {fmt_ms(dur)}" if isinstance(dur, int) else ""
    return f"[{kind}] {item_title(item)}" + (f" - {sub}" if sub else "") + tail


class ItemList:
    def __init__(self) -> None:
        self.rows: list[Row] = []
        self.cursor = 0
        self.top = 0
        self.next_cursor: str | None = None
        self.loading = False
        self.loaded = False
        self.notice = ""  # shown above the rows, e.g. "Only the first 500 were added"

    def clear(self) -> None:
        self.rows = []
        self.cursor = self.top = 0
        self.next_cursor = None
        self.loaded = False
        self.notice = ""

    def add_items(self, items: list[Any], next_cursor: Any = None) -> None:
        for it in items:
            if isinstance(it, dict):
                self.rows.append(Row(item_text(it), it))
        self.next_cursor = next_cursor if isinstance(next_cursor, str) else None
        self.loaded = True
        self._fix()

    def add_row(self, row: Row) -> None:
        self.rows.append(row)
        self._fix()

    @property
    def selected(self) -> Row | None:
        if 0 <= self.cursor < len(self.rows) and self.rows[self.cursor].selectable:
            return self.rows[self.cursor]
        return None

    def move(self, delta: int) -> None:
        if not self.rows:
            return
        step = 1 if delta > 0 else -1
        target = max(0, min(len(self.rows) - 1, self.cursor + delta))
        # Skip headers in the direction of travel.
        while 0 <= target < len(self.rows) and not self.rows[target].selectable:
            target += step
        if 0 <= target < len(self.rows):
            self.cursor = target

    def home(self) -> None:
        self.cursor = 0
        self._fix()

    def end(self) -> None:
        self.cursor = max(0, len(self.rows) - 1)

    def _fix(self) -> None:
        self.cursor = max(0, min(self.cursor, len(self.rows) - 1))
        if self.rows and not self.rows[self.cursor].selectable:
            self.move(1)

    def render(self, height: int, empty: str = "Nothing here.") -> list[Line]:
        lines: list[Line] = []
        if self.notice:
            lines.append((self.notice, "bold"))
        if not self.rows:
            lines.append(("Loading..." if self.loading else empty, ""))
            return lines
        room = max(1, height - len(lines) - 1)
        if self.cursor < self.top:
            self.top = self.cursor
        elif self.cursor >= self.top + room:
            self.top = self.cursor - room + 1
        for i in range(self.top, min(len(self.rows), self.top + room)):
            r = self.rows[i]
            if not r.selectable:
                lines.append((r.text, "bold"))
            else:
                lines.append(("> " + r.text if i == self.cursor else "  " + r.text, "reverse" if i == self.cursor else ""))
        if self.loading:
            lines.append(("  Loading more...", ""))
        elif self.next_cursor:
            lines.append((f"  ... {len(self.rows)} shown, press m for more", ""))
        return lines
