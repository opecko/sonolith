"""Item references typed by the user (SPEC section 13.1 "Items and ids": `Ref`, `MediaRef`, `PlayableRef`).

The Queue and Playlists screens let you add items by id. `abc123` is a track; `episode:abc123`, `album:MPREb...`,
`playlist:PL...` and `podcast:...` name the other types. Several can be given at once, separated by spaces or commas.
"""

from __future__ import annotations

PLAYABLE = ("track", "episode", "album", "playlist", "podcast")
MEDIA = ("track", "episode")


def parse_refs(text: str, allowed: tuple[str, ...] = PLAYABLE) -> tuple[list[dict], list[str]]:
    """The refs in `text`, and the words that aren't valid refs of an allowed type."""
    refs: list[dict] = []
    bad: list[str] = []
    for word in text.replace(",", " ").split():
        kind, sep, ident = word.partition(":")
        if not sep:
            kind, ident = "track", word
        if kind not in allowed or not ident:
            bad.append(word)
            continue
        refs.append({"type": kind, "id": ident})
    return refs, bad


def ref_of(item: dict | None) -> dict | None:
    """The `{type, id}` of an item from any list, or None when it has neither."""
    if not isinstance(item, dict):
        return None
    kind, ident = item.get("type"), item.get("id")
    return {"type": kind, "id": ident} if isinstance(kind, str) and isinstance(ident, str) else None
