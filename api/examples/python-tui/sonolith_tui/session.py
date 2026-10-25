"""The connection's life: register, say hello, stay connected, reconnect, and stop when access ends (SPEC section 6
"Registration and consent", section 7 "Tokens and sessions", section 9 "Disconnecting and revoking", section 3.4
"Sonolith not available", section 12.1 "Rate limits", section 18 "Integration checklist").

Rules this module keeps:

- `app.register` runs only from `connect()`, which the UI calls only when the user presses "Connect". Nothing here
  registers on its own: not at startup, not after `Unauthorized`, `NotRegistered`, `session.revoked`, a denial or an
  expiry (6.1).
- While a request is pending the registering connection stays open; on approval the token is stored first, then
  `session.hello` is sent on the same connection (6.1, 16 `registration.resolved`).
- A denial or expiry carries `retryAfterMs`: the UI shows a countdown from it (6.4). `Blocked` stops asking.
- Every connection starts with `session.hello` (7.3). `Unauthorized` and `NotRegistered` delete the token and show
  "Disconnected from Sonolith"; `Blocked` too; `RegistrationPending` (`identityChanged`) waits for the user (6.6).
- When Sonolith is not available, retry with backoff (1 s doubling to 60 s, +-20 % jitter), reset after a hello.
- `session.revoked` deletes the token and stops (9.2). `disconnect()` is the "Disconnect from Sonolith" action: it
  calls `app.unregister` and deletes the token even when Sonolith can't be reached (9.1).
- A `RateLimited` answer puts that rate class on hold for `retryAfterMs`; calls before then fail locally (12.1).
- Only granted scopes are used; topics are subscribed per granted scope, again after reconnecting and when
  `session.scopesChanged` adds scopes (8, 10.3).
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Awaitable, Callable

from . import scopes as sc
from .backoff import Backoff
from .client import Connection, TraceHandler
from .discovery import discover, open_stream
from .errors import (
    ConnectionClosed,
    LocalRateLimit,
    NotAvailable,
    NotConnected,
    RpcError,
    SonolithError,
    user_message,
    wait_text,
)
from .token_store import FileTokenStore

Opener = Callable[[], Awaitable[tuple[asyncio.StreamReader, asyncio.StreamWriter]]]

POSITION_HZ = 2


class Phase(str, Enum):
    NOT_CONNECTED = "not connected"  # no token: waiting for the user to press Connect
    CONNECTING = "connecting"
    UNAVAILABLE = "unavailable"  # Sonolith not running or API off; retrying with backoff
    REGISTERING = "waiting for approval"  # app.register pending: the user answers in Sonolith
    IDENTITY = "waiting for approval (moved)"  # identityChanged: the user approves the new location
    CONNECTED = "connected"
    DENIED = "declined"  # cooldown: ask again only after retry_at, and only on a user action
    BLOCKED = "blocked"
    STOPPED = "stopped"  # needs the user (identity not approved, unsupported version)


@dataclass(frozen=True)
class Status:
    phase: Phase = Phase.NOT_CONNECTED
    message: str = ""
    retry_at: float | None = None  # time.monotonic() deadline for a countdown, or None
    granted: frozenset[str] = frozenset()
    signed_in: bool | None = None
    identity: dict | None = None
    api_version: str | None = None
    app_version: str | None = None

    def remaining_ms(self, now: float | None = None) -> int | None:
        if self.retry_at is None:
            return None
        return max(0, int((self.retry_at - (now if now is not None else time.monotonic())) * 1000))


async def default_opener() -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    return await open_stream(discover())


@dataclass
class _Outcomes:
    """`registration.resolved` events by request id; kept until someone waits for them (an event can arrive before
    the code that waits for it runs)."""

    seen: dict[str, dict] = field(default_factory=dict)
    waiters: dict[str, asyncio.Future] = field(default_factory=dict)

    def put(self, params: dict) -> bool:
        rid = params.get("requestId")
        if not isinstance(rid, str):
            return False
        fut = self.waiters.pop(rid, None)
        if fut is not None and not fut.done():
            fut.set_result(params)
            return True
        self.seen[rid] = params
        return False

    async def wait(self, rid: str, conn: Connection) -> dict | None:
        """The outcome, or None when the connection closed first."""
        if rid in self.seen:
            return self.seen.pop(rid)
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.waiters[rid] = fut
        closed = asyncio.ensure_future(conn.closed.wait())
        try:
            done, _ = await asyncio.wait({fut, closed}, return_when=asyncio.FIRST_COMPLETED)
            return fut.result() if fut in done else None
        finally:
            closed.cancel()
            self.waiters.pop(rid, None)


class Session:
    def __init__(
        self,
        tokens: FileTokenStore | Any,
        on_status: Callable[[Status], None] | None = None,
        on_event: Callable[[str, dict], None] | None = None,
        on_notice: Callable[[str, str], None] | None = None,
        on_trace: TraceHandler | None = None,
        opener: Opener | None = None,
        backoff: Backoff | None = None,
        registration: dict | None = None,
        hello_timeout: float = 10.0,
    ) -> None:
        self.tokens = tokens
        self.on_status = on_status
        self.on_event = on_event
        self.on_notice = on_notice
        self.on_trace = on_trace
        self.opener = opener or default_opener
        self.backoff = backoff or Backoff()
        self.registration = registration or sc.REGISTRATION
        self.hello_timeout = hello_timeout
        self.status = Status()
        self.conn: Connection | None = None
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._stopping = False
        self._register_requested = False
        self._hold = False  # a token exists but reconnecting needs the user (identity denied, old Sonolith)
        self._ending: str | None = None  # why the current connection ends on purpose
        self._outcomes = _Outcomes()
        self._rate_hold: dict[str, float] = {}
        self.scope_retry_at: float | None = None  # cooldown for app.requestScopes after a denial
        self.pending_scope_request: str | None = None

    # ------------------------------------------------------------ lifecycle

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.ensure_future(self._run())

    async def stop(self) -> None:
        self._stopping = True
        self._wake.set()
        if self.conn is not None:
            self.conn.close()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    def _set(self, **changes: Any) -> None:
        self.status = replace(self.status, **changes)
        if self.on_status is not None:
            self.on_status(self.status)

    def _notice(self, text: str, severity: str = "information") -> None:
        if self.on_notice is not None:
            self.on_notice(text, severity)

    def _trace(self, direction: str, what: str, details: Any) -> None:
        if self.on_trace is not None:
            self.on_trace(direction, what, details)

    async def _sleep_or_wake(self, seconds: float) -> None:
        try:
            await asyncio.wait_for(self._wake.wait(), timeout=max(0.0, seconds))
        except asyncio.TimeoutError:
            pass
        self._wake.clear()

    # ------------------------------------------------------------ user actions

    def connect(self) -> bool:
        """The user pressed "Connect to Sonolith" (or "Try again"). Returns False when asking is on hold."""
        if self.status.phase in (Phase.CONNECTED, Phase.CONNECTING, Phase.REGISTERING, Phase.IDENTITY):
            return False
        remaining = self.status.remaining_ms() if self.status.phase == Phase.DENIED else None
        if remaining:
            self._notice(f"You can ask again in {wait_text(remaining)}.", "warning")
            return False
        if self.tokens.load() is None:
            self._register_requested = True
        self._hold = False
        self.backoff.reset()
        self._wake.set()
        return True

    def cancel_registration(self) -> None:
        """Withdraws a pending request: closing the connection cancels it in Sonolith (6.1)."""
        if self.status.phase in (Phase.REGISTERING, Phase.IDENTITY) and self.conn is not None:
            self._ending = "cancelled"
            self.conn.close()

    async def disconnect(self) -> None:
        """"Disconnect from Sonolith" (9.1): `app.unregister`, then delete the token in any case."""
        self._register_requested = False
        self._hold = False
        token = self.tokens.load()
        reached = False
        try:
            if self.status.phase == Phase.CONNECTED and self.conn is not None:
                self._ending = "unregistered"
                await self.conn.call("app.unregister", timeout=5)
                reached = True
            elif token:
                reader, writer = await asyncio.wait_for(self.opener(), timeout=5)
                conn = Connection(reader, writer, on_trace=self.on_trace)
                try:
                    await conn.call("session.hello", self._hello_params(token), timeout=5)
                    await conn.call("app.unregister", timeout=5)
                    reached = True
                finally:
                    conn.close()
            else:
                reached = True
        except (SonolithError, OSError, asyncio.TimeoutError) as e:
            self._trace("!!", "app.unregister", user_message(e))
        finally:
            self.tokens.delete()
            if self.conn is not None:
                self._ending = "unregistered"
                self.conn.close()
            if reached:
                msg = "Disconnected from Sonolith."
            else:
                msg = (
                    "Disconnected. Sonolith couldn't be reached, so this app stays in its list until you remove it "
                    "there (Settings → Connected apps)."
                )
            self._set(phase=Phase.NOT_CONNECTED, message=msg, retry_at=None, granted=frozenset(), identity=None)
            self._wake.set()

    async def request_scopes(self, wanted: list[str]) -> dict | None:
        """Asks the user for more scopes (6.5). Only after a user action. The outcome comes as an event."""
        if self.scope_retry_at is not None:
            left = int((self.scope_retry_at - time.monotonic()) * 1000)
            if left > 0:
                self._notice(f"Sonolith declined recently. You can ask again in {wait_text(left)}.", "warning")
                return None
            self.scope_retry_at = None
        try:
            result = await self.call("app.requestScopes", {"scopes": sc.scope_requests(wanted)})
        except RpcError as e:
            if e.name == "RegistrationDenied":
                self.scope_retry_at = time.monotonic() + (e.retry_after_ms or 0) / 1000
            raise
        if isinstance(result, dict) and result.get("status") == "pending":
            self.pending_scope_request = result.get("requestId")
            self._notice("Asked Sonolith. Answer the request in Sonolith.", "information")
        elif isinstance(result, dict) and result.get("status") == "granted":
            self._notice("This app already has that permission.", "information")
        return result

    # ------------------------------------------------------------ calls

    async def call(self, method: str, params: dict | None = None, timeout: float | None = None) -> Any:
        conn = self.conn if self.status.phase == Phase.CONNECTED else None
        if conn is None:
            raise NotConnected(method)
        needed = sc.METHOD_SCOPES.get(method)
        if needed and not any(s in self.status.granted for s in needed):
            # Section 8: don't call what isn't granted; answer locally like Sonolith would.
            raise RpcError({"code": -32003, "message": "PermissionDenied",
                            "data": {"name": "PermissionDenied", "reason": None, "scope": needed[0]}}, method)
        rate = sc.RATE_CLASSES.get(method, "local")
        until = self._rate_hold.get(rate)
        if until is not None:
            left = int((until - time.monotonic()) * 1000)
            if left > 0:
                raise LocalRateLimit(rate, left)
            del self._rate_hold[rate]
        try:
            return await conn.call(method, params, timeout=timeout)
        except RpcError as e:
            if e.name == "RateLimited":
                self._rate_hold[rate] = time.monotonic() + (e.retry_after_ms or 1000) / 1000
            raise

    def rate_hold_ms(self, rate_class: str) -> int:
        until = self._rate_hold.get(rate_class)
        return max(0, int((until - time.monotonic()) * 1000)) if until else 0

    # ------------------------------------------------------------ the loop

    def _hello_params(self, token: str) -> dict:
        return {"appId": self.registration["appId"], "token": token, "apiVersion": sc.API_VERSION}

    async def _run(self) -> None:
        while not self._stopping:
            self._ending = None
            token = self.tokens.load()
            registering = self._register_requested
            if (not token and not registering) or (token and self._hold):
                if not token and self.status.phase not in (Phase.NOT_CONNECTED, Phase.DENIED, Phase.BLOCKED):
                    self._set(phase=Phase.NOT_CONNECTED, retry_at=None, granted=frozenset())
                await self._wake.wait()
                self._wake.clear()
                continue
            self._set(phase=Phase.CONNECTING, message="", retry_at=None)
            try:
                reader, writer = await self.opener()
            except NotAvailable as e:
                if registering:
                    self._register_requested = False
                    self._set(phase=Phase.NOT_CONNECTED, message=e.user_message())
                    continue
                delay = self.backoff.next_delay()
                self._set(phase=Phase.UNAVAILABLE, message=e.user_message(), retry_at=time.monotonic() + delay,
                          granted=frozenset())
                await self._sleep_or_wake(delay)
                continue
            conn = Connection(reader, writer, on_event=lambda m, p: self._on_conn_event(conn, m, p),
                              on_trace=self.on_trace)
            self.conn = conn
            retry_after = 0.0
            try:
                if registering:
                    self._register_requested = False
                    token = await self._register(conn)
                    if token is None:
                        continue
                retry_after = await self._hello_and_serve(conn, token)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # never let the loop die
                self._trace("!!", "session", repr(e))
                retry_after = 1.0
            finally:
                conn.close()
                self.conn = None
            if self._stopping:
                break
            if retry_after < 0:
                continue  # access ended or needs the user: the next round waits for them
            if self._ending in ("unregistered", "revoked", "cancelled"):
                continue
            delay = self.backoff.next_delay(at_least=retry_after)
            if self.status.phase != Phase.UNAVAILABLE or not self.status.message:
                msg = "Sonolith went away." if self.status.phase == Phase.CONNECTED else self.status.message
                self._set(phase=Phase.UNAVAILABLE, message=msg or NotAvailable().user_message(),
                          retry_at=time.monotonic() + delay, granted=frozenset())
            else:
                self._set(retry_at=time.monotonic() + delay)
            await self._sleep_or_wake(delay)

    async def _register(self, conn: Connection) -> str | None:
        """`app.register` and the wait for the user's answer. Returns the token, or None."""
        try:
            pending = await conn.call("app.register", self.registration)
        except RpcError as e:
            self._registration_refused(e)
            return None
        except SonolithError as e:
            self._set(phase=Phase.NOT_CONNECTED, message=e.user_message())
            return None
        rid = pending.get("requestId") if isinstance(pending, dict) else None
        if not isinstance(rid, str):
            self._set(phase=Phase.NOT_CONNECTED, message="Sonolith gave an unexpected answer.")
            return None
        self._set(phase=Phase.REGISTERING, identity=pending.get("identity"),
                  message="Sonolith is asking you: answer “Sonolith TUI wants to connect to Sonolith” in Sonolith.")
        outcome = await self._outcomes.wait(rid, conn)
        if outcome is None:
            msg = "Request cancelled." if self._ending == "cancelled" else "Sonolith closed the connection; the request ended."
            self._set(phase=Phase.NOT_CONNECTED, message=msg)
            return None
        status = outcome.get("status")
        if status == "approved" and isinstance(outcome.get("token"), str):
            self.tokens.save(outcome["token"])  # first, before anything else: it is sent only once
            granted = frozenset(s for s in outcome.get("grantedScopes") or [] if isinstance(s, str))
            self._set(granted=granted, message="Approved.")
            return outcome["token"]
        self._resolved_not_approved(outcome, "register")
        return None

    def _registration_refused(self, e: RpcError) -> None:
        if e.name == "Blocked":
            self._set(phase=Phase.BLOCKED, retry_at=None, message=e.user_message())
        elif e.name == "RegistrationDenied":
            ms = e.retry_after_ms or 0
            self._set(phase=Phase.DENIED, retry_at=time.monotonic() + ms / 1000,
                      message="You declined this app recently in Sonolith.")
        elif e.name == "RegistrationPending":
            self._set(phase=Phase.NOT_CONNECTED, message="A request from this app is already waiting in Sonolith. "
                                                         "Answer it there, or close the other copy of this app.")
        else:
            self._set(phase=Phase.NOT_CONNECTED, message=e.user_message())

    def _resolved_not_approved(self, outcome: dict, kind: str) -> None:
        status = outcome.get("status")
        retry = outcome.get("retryAfterMs")
        retry_at = time.monotonic() + retry / 1000 if isinstance(retry, int) else None
        if status == "blocked":
            self.tokens.delete()
            self._set(phase=Phase.BLOCKED, retry_at=None,
                      message="You blocked this app in Sonolith. You can unblock it in Settings → Connected apps.")
        elif status == "expired":
            self._set(phase=Phase.DENIED if kind == "register" else Phase.STOPPED, retry_at=retry_at,
                      message="Nobody answered in Sonolith within 5 minutes.")
        else:  # denied, or a status this version doesn't know
            self._set(phase=Phase.DENIED if kind == "register" else Phase.STOPPED, retry_at=retry_at,
                      message="You chose “Not now” in Sonolith." if kind == "register"
                      else "The new location wasn't approved; the old one still works.")

    async def _hello_and_serve(self, conn: Connection, token: str) -> float:
        """Hello, subscribe, and serve until the connection ends. Returns the minimum wait before reconnecting in
        seconds, or -1 when the next connection needs the user."""
        while True:
            try:
                hello = await conn.call("session.hello", self._hello_params(token), timeout=self.hello_timeout)
                break
            except RpcError as e:
                if e.name in ("Unauthorized", "NotRegistered"):
                    self.tokens.delete()
                    self._set(phase=Phase.NOT_CONNECTED, retry_at=None, granted=frozenset(),
                              message="Disconnected from Sonolith: this app's access ended. Press Connect to ask again.")
                    return -1
                if e.name == "Blocked":
                    self.tokens.delete()
                    self._set(phase=Phase.BLOCKED, retry_at=None, granted=frozenset(), message=e.user_message())
                    return -1
                if e.name == "UnsupportedVersion":
                    self._hold = True
                    self._set(phase=Phase.STOPPED, message=e.user_message())
                    return -1
                if e.name == "RegistrationPending" and isinstance(e.data.get("requestId"), str):
                    self._set(phase=Phase.IDENTITY, message="This app was moved or updated. Sonolith is asking you to "
                                                            "approve it again; answer in Sonolith.")
                    outcome = await self._outcomes.wait(e.data["requestId"], conn)
                    if outcome is None:
                        return 0.0
                    if outcome.get("status") == "approved":
                        continue  # the same token now works from here: say hello again
                    self._hold = outcome.get("status") != "blocked"
                    self._resolved_not_approved(outcome, "identity")
                    return -1
                self._set(message=e.user_message())
                return (e.retry_after_ms or 0) / 1000
            except SonolithError as e:
                self._set(message=e.user_message())
                return 0.0
        if not isinstance(hello, dict):
            return 1.0
        self.backoff.reset()
        granted = frozenset(s for s in hello.get("grantedScopes") or [] if isinstance(s, str))
        self._set(phase=Phase.CONNECTED, message="", retry_at=None, granted=granted,
                  signed_in=hello.get("signedIn") if isinstance(hello.get("signedIn"), bool) else None,
                  identity=hello.get("identity"), api_version=hello.get("apiVersion"),
                  app_version=hello.get("appVersion"))
        await self._subscribe(conn, sc.topics_for(granted))
        await conn.closed.wait()
        if self._ending is None:
            self._trace("--", "connection", "closed by Sonolith")
        return 0.0

    async def _subscribe(self, conn: Connection, topics: list[str]) -> None:
        if not topics:
            return
        try:
            await conn.call("events.subscribe", {"topics": topics, "positionHz": POSITION_HZ})
        except RpcError as e:
            self._notice(e.user_message(), "warning")
        except SonolithError:
            pass

    # ------------------------------------------------------------ events

    def _on_conn_event(self, conn: Connection, method: str, params: dict) -> None:
        if method == "registration.resolved":
            kind = params.get("kind")
            self._outcomes.put(params)
            if kind == "scopes":
                self._scope_outcome(params)
        elif method == "session.revoked":
            self._ending = "revoked"
            self.tokens.delete()  # 9.2: stop, delete the token, tell the user, don't register again on our own
            reason = params.get("reason")
            why = {
                "blocked": "you blocked this app in Sonolith",
                "unregistered": "this app disconnected itself in another window",
                "replaced": "this app connected again elsewhere and got a new token",
            }.get(reason if isinstance(reason, str) else "", "you removed this app in Sonolith")
            phase = Phase.BLOCKED if reason == "blocked" else Phase.NOT_CONNECTED
            self._set(phase=phase, retry_at=None, granted=frozenset(), message=f"Disconnected from Sonolith: {why}.")
        elif method == "session.scopesChanged":
            scopes = params.get("grantedScopes")
            if isinstance(scopes, list):
                old = self.status.granted
                new = frozenset(s for s in scopes if isinstance(s, str))
                self._set(granted=new)
                added = [t for t in sc.topics_for(new) if t not in sc.topics_for(old)]
                if added and conn is self.conn:
                    asyncio.ensure_future(self._subscribe(conn, added))
        elif method == "account.changed":
            if isinstance(params.get("signedIn"), bool):
                self._set(signed_in=params["signedIn"])
        if self.on_event is not None:
            self.on_event(method, params)

    def _scope_outcome(self, params: dict) -> None:
        if params.get("requestId") == self.pending_scope_request:
            self.pending_scope_request = None
        status = params.get("status")
        if status == "approved":
            self._notice("Sonolith granted the permission.", "information")
            return
        retry = params.get("retryAfterMs")
        if isinstance(retry, int):
            self.scope_retry_at = time.monotonic() + retry / 1000
        if status == "blocked":
            self._notice("You blocked this app in Sonolith.", "error")
        elif status == "expired":
            self._notice("Nobody answered the permission request in Sonolith.", "warning")
        else:
            wait = f" You can ask again in {wait_text(retry)}." if isinstance(retry, int) else ""
            self._notice("Sonolith didn't grant the permission." + wait, "warning")
