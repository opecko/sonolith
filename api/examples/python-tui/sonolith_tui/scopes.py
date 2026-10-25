"""What this app asks for and why (SPEC section 6.1 "The flow", section 8 "Scopes", section 12.1 "Rate limits").

The app asks for all eight scopes, each with a reason the user reads on Sonolith's consent screen. Only
`player:read` is required: without it there is nothing to show. Everything else is optional; the user can untick it,
and the matching screen then shows "Not allowed"; pressing P there asks for it again (`app.requestScopes`).
"""

from __future__ import annotations

from dataclasses import dataclass

APP_ID = "com.example.sonolith-tui"
API_VERSION = "1.0"


@dataclass(frozen=True)
class ScopeInfo:
    scope: str
    label: str  # exactly what the user sees in Sonolith (section 8)
    required: bool
    reason: str  # shown under the label on the consent screen: what the user gets
    sensitive: bool = False


SCOPES: tuple[ScopeInfo, ...] = (
    ScopeInfo("player:read", "See what's playing", True, "To show the current song, its progress and the volume"),
    ScopeInfo("player:control", "Control playback", False, "To play, pause, skip, seek and change the volume from the terminal"),
    ScopeInfo("queue:read", "See your queue", False, "To list what plays next"),
    ScopeInfo("queue:write", "Change your queue", False, "To add, move and remove songs in your queue"),
    ScopeInfo("library:read", "Access your library", False, "To list your playlists, liked songs, albums, artists, podcasts and history"),
    ScopeInfo("library:write", "Change your library", False, "To like songs and to create, rename and edit your playlists when you ask", sensitive=True),
    ScopeInfo("search", "Search YouTube Music", False, "To search and to open albums, artists and podcasts"),
    ScopeInfo("lyrics:read", "Show lyrics", False, "To show the lyrics of the current song as it plays"),
)

BY_SCOPE = {s.scope: s for s in SCOPES}

REGISTRATION = {
    "appId": APP_ID,
    "name": "Sonolith TUI",
    "description": "A terminal app to see and control what Sonolith plays, your queue, library, lyrics and search.",
    "publisher": "Sonolith API examples",
    "homepage": "https://github.com/opecko/sonolith/tree/master/api/examples/python-tui",
    "scopes": [{"scope": s.scope, "required": s.required, "reason": s.reason} for s in SCOPES],
    "apiVersion": API_VERSION,
}


def scope_requests(scopes: list[str] | tuple[str, ...]) -> list[dict]:
    """`ScopeRequest` objects for `app.requestScopes`. A scope asked for on its own is marked required: the user
    clicked a button to get exactly that one."""
    return [{"scope": s, "required": True, "reason": BY_SCOPE[s].reason} for s in scopes if s in BY_SCOPE]


def label(scope: str) -> str:
    info = BY_SCOPE.get(scope)
    return info.label if info else scope


# Section 8: the scope each method needs. `playlist.get` accepts either of two.
METHOD_SCOPES: dict[str, tuple[str, ...]] = {
    "player.getState": ("player:read",),
    **{m: ("player:control",) for m in (
        "player.play", "player.pause", "player.toggle", "player.next", "player.previous", "player.seek",
        "player.setVolume", "player.setShuffle", "player.setRepeat", "player.setRate", "player.playItem",
    )},
    "queue.get": ("queue:read",),
    **{m: ("queue:write",) for m in (
        "queue.add", "queue.playNext", "queue.move", "queue.remove", "queue.clear", "queue.setAutoplay",
    )},
    **{m: ("library:read",) for m in (
        "library.playlists", "library.likedSongs", "library.albums", "library.artists", "library.podcasts",
        "library.episodesForLater", "library.history",
    )},
    "playlist.get": ("library:read", "search"),
    **{m: ("library:write",) for m in (
        "playlist.create", "playlist.rename", "playlist.delete", "playlist.addTracks", "playlist.removeTracks",
        "rating.set",
    )},
    **{m: ("search",) for m in (
        "search.query", "search.suggestions", "browse.album", "browse.artist", "browse.podcast", "browse.episode",
    )},
    "lyrics.get": ("lyrics:read",),
}

# Section 12.1: every method's rate class. A `RateLimited` answer puts the whole class on hold.
RATE_CLASSES: dict[str, str] = {
    **{m: "local" for m in ("app.info", "events.subscribe", "events.unsubscribe", "player.getState", "queue.get")},
    **{m: "control" for m in (
        "player.play", "player.pause", "player.toggle", "player.next", "player.previous", "player.seek",
        "player.setVolume", "player.setShuffle", "player.setRepeat", "player.setRate", "player.playItem",
        "queue.add", "queue.playNext", "queue.move", "queue.remove", "queue.clear", "queue.setAutoplay",
    )},
    **{m: "network" for m in (
        "library.playlists", "library.likedSongs", "library.albums", "library.artists", "library.podcasts",
        "library.episodesForLater", "library.history", "playlist.get", "search.query", "search.suggestions",
        "browse.album", "browse.artist", "browse.podcast", "browse.episode", "lyrics.get",
    )},
    **{m: "account" for m in (
        "playlist.create", "playlist.rename", "playlist.delete", "playlist.addTracks", "playlist.removeTracks",
        "rating.set",
    )},
    **{m: "auth" for m in ("app.register", "app.requestScopes", "app.unregister", "session.hello")},
}

# Section 10.1: topics and the scope each needs (None: any session).
TOPICS: dict[str, str | None] = {
    "player.state": "player:read",
    "player.track": "player:read",
    "player.position": "player:read",
    "player.volume": "player:read",
    "queue": "queue:read",
    "lyrics": "lyrics:read",
    "lyrics.line": "lyrics:read",
    # `lyrics.word` is left out on purpose: the SPEC advises animating words from `player.position` instead.
    "account": None,
}


def allowed(granted: set[str] | frozenset[str], method: str) -> bool:
    """True when the granted scopes allow the method (section 8: use only granted scopes)."""
    needed = METHOD_SCOPES.get(method)
    return needed is None or any(s in granted for s in needed)


def topics_for(granted: set[str] | frozenset[str]) -> list[str]:
    """The topics this app subscribes to with these scopes."""
    return [t for t, s in TOPICS.items() if s is None or s in granted]
