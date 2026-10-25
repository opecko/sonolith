"""Errors and the messages a person reads for them (SPEC section 11, "Errors", and 11.3, "Error reasons").

Every error Sonolith sends is a JSON-RPC error object whose `data` has `name` and `reason`. This module turns them
into exceptions that keep the machine-readable parts (`code`, `name`, `reason`, `data`) and into one plain sentence
for the UI, so the app never shows a traceback. Match on `code` or `name`, never on `message` (section 11).
"""

from __future__ import annotations

from typing import Any

# Section 11.1: the error codes.
CODES: dict[int, str] = {
    -32700: "ParseError",
    -32600: "InvalidRequest",
    -32601: "MethodNotFound",
    -32602: "InvalidParams",
    -32603: "InternalError",
    -32001: "NotRegistered",
    -32002: "Unauthorized",
    -32003: "PermissionDenied",
    -32004: "RegistrationPending",
    -32005: "RegistrationDenied",
    -32006: "Blocked",
    -32007: "NotSignedIn",
    -32008: "NotFound",
    -32009: "RateLimited",
    -32010: "Unavailable",
    -32011: "Timeout",
    -32012: "SessionRequired",
    -32013: "UnsupportedVersion",
}


class SonolithError(Exception):
    """Base class of everything this client raises on purpose."""

    def user_message(self) -> str:
        return str(self)


class NotAvailable(SonolithError):
    """Sonolith is not running, or "Let other apps connect to Sonolith" is off (section 3.4). The two look the same."""

    def user_message(self) -> str:
        return (
            "Sonolith is not running, or “Let other apps connect to Sonolith” is off in its "
            "Settings → Connected apps."
        )


class ConnectionClosed(SonolithError):
    """The connection ended while a call was waiting for its answer."""

    def user_message(self) -> str:
        return "The connection to Sonolith closed before it answered."


class NotConnected(SonolithError):
    """A call was made while there is no authenticated session."""

    def user_message(self) -> str:
        return "Not connected to Sonolith."


class LocalRateLimit(SonolithError):
    """Raised before sending: Sonolith told us to wait (section 12.1) and the wait is not over yet."""

    def __init__(self, rate_class: str, wait_ms: int) -> None:
        super().__init__(f"{rate_class} calls are on hold for {wait_ms} ms")
        self.rate_class = rate_class
        self.wait_ms = wait_ms

    def user_message(self) -> str:
        return f"Sonolith asked this app to slow down. Try again in {wait_text(self.wait_ms)}."


class RpcError(SonolithError):
    """An error answer from Sonolith. Keeps `code`, `name`, `reason` and the whole `data` object."""

    def __init__(self, error: dict[str, Any], method: str | None = None) -> None:
        self.code: int | None = error.get("code") if isinstance(error.get("code"), int) else None
        data = error.get("data")
        self.data: dict[str, Any] = data if isinstance(data, dict) else {}
        name = self.data.get("name")
        if not isinstance(name, str):
            name = CODES.get(self.code or 0, str(error.get("message") or "Error"))
        self.name: str = name
        reason = self.data.get("reason")
        self.reason: str | None = reason if isinstance(reason, str) else None
        self.method = method
        super().__init__(f"{self.name} ({self.code}){': ' + self.reason if self.reason else ''}")

    @property
    def retry_after_ms(self) -> int | None:
        value = self.data.get("retryAfterMs")
        return value if isinstance(value, int) and value >= 0 else None

    def user_message(self) -> str:
        return describe_rpc_error(self)


def wait_text(ms: int | float | None) -> str:
    """A wait for people: "40 s", "10 min", "1 h", rounded up (section 6.4: show the wait from `retryAfterMs`)."""
    if ms is None or ms <= 0:
        return "a moment"
    seconds = int(-(-ms // 1000))
    if seconds < 60:
        return f"{seconds} s"
    minutes = -(-seconds // 60)
    if minutes < 60:
        return f"{minutes} min"
    hours = minutes // 60
    rest = minutes % 60
    return f"{hours} h" if rest == 0 else f"{hours} h {rest} min"


# Plain-language labels of the scopes, as the user sees them on the consent screen (section 8). Kept here too, so
# that error messages can name a scope without importing the scope table.
_SCOPE_LABELS = {
    "player:read": "See what's playing",
    "player:control": "Control playback",
    "queue:read": "See your queue",
    "queue:write": "Change your queue",
    "library:read": "Access your library",
    "library:write": "Change your library",
    "search": "Search YouTube Music",
    "lyrics:read": "Show lyrics",
}

_REASONS = {
    "nothingPlaying": "Nothing is playing in Sonolith.",
    "notEditable": "This playlist can't be changed (it may belong to someone else).",
    "notPlayable": "YouTube doesn't allow playing this item.",
    "starting": "Sonolith is still starting.",
    "peerUnverified": "Sonolith couldn't identify this program, so it can't connect it.",
    "cursorExpired": "The list changed in the meantime; load it again from the start.",
    "resultTooLarge": "The answer was too large; ask for fewer items.",
    "tooManyPending": "Too many apps are waiting for an answer in Sonolith right now.",
    "tooManyInFlight": "Too many requests at once.",
    "tooManyConnections": "This app has too many open connections to Sonolith.",
    "unknownParam": "This Sonolith doesn't know a parameter this app sent; it may be older than the app.",
    "messageTooLarge": "A request was too large.",
    "identityChanged": "This app was moved or updated; Sonolith is asking you to approve it again.",
}


def describe_rpc_error(e: RpcError) -> str:
    """One readable sentence for an error answer. Unknown reasons are treated like null (section 11)."""
    retry = e.retry_after_ms
    later = f" Try again in {wait_text(retry)}." if retry else ""
    reason_text = _REASONS.get(e.reason or "")
    name = e.name
    if name == "PermissionDenied":
        scope = e.data.get("scope")
        label = _SCOPE_LABELS.get(scope, scope or "this")
        return f"Not allowed: this app doesn't have the “{label}” permission in Sonolith."
    if name == "RateLimited":
        base = reason_text or "Sonolith asked this app to slow down."
        return base + (later or " Try again in a moment.")
    if name == "Unavailable":
        return (reason_text or "That's not possible right now.") + later
    if name == "NotSignedIn":
        return "Sign in to YouTube in Sonolith first."
    if name == "NotFound":
        return "Not found: the item doesn't exist or isn't visible to this app."
    if name == "Timeout":
        return "Sonolith or YouTube didn't answer in time. Try again later."
    if name == "InvalidParams":
        if reason_text:
            return reason_text
        path = e.data.get("path")
        return "Sonolith rejected a value" + (f" ({path})" if path else "") + "."
    if name == "InternalError":
        return (reason_text or "Sonolith ran into a problem.") + " Try again later."
    if name in ("Unauthorized", "NotRegistered"):
        return "Disconnected from Sonolith: this app's access ended. Connect again to continue."
    if name == "Blocked":
        return "Sonolith blocked this app. You can unblock it in Sonolith's Settings → Connected apps."
    if name == "RegistrationDenied":
        return f"Access was declined recently. You can ask again in {wait_text(retry)}."
    if name == "RegistrationPending":
        return reason_text if e.reason == "identityChanged" else "A request from this app is already waiting in Sonolith."
    if name == "UnsupportedVersion":
        return "This Sonolith doesn't speak this app's API version. Update Sonolith or this app."
    if name == "MethodNotFound":
        return "This Sonolith doesn't support that feature (it may be older than this app)."
    if name == "SessionRequired":
        return "Not connected to Sonolith yet."
    if name in ("InvalidRequest", "ParseError"):
        return (reason_text or "Sonolith couldn't read a request from this app.")
    return f"Sonolith answered with an error ({name})." + later


def user_message(exc: BaseException) -> str:
    """A readable sentence for any exception a call can raise. Never a traceback."""
    if isinstance(exc, SonolithError):
        return exc.user_message()
    if isinstance(exc, (ConnectionError, OSError)):
        return "The connection to Sonolith failed."
    if isinstance(exc, TimeoutError):
        return "Sonolith didn't answer in time."
    return f"Something went wrong ({type(exc).__name__})."
