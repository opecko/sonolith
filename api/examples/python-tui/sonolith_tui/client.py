"""One JSON-RPC connection to Sonolith (SPEC section 4 "Protocol": 4.1 JSON-RPC 2.0, 4.2 Framing, 4.3 Order and
concurrency; section 12 "Limits").

- Every message is one UTF-8 JSON value followed by `\\n`; a `\\r` before it is ignored and empty lines are skipped.
- Reads are buffered by hand, so a message split across reads (or several in one read) is handled, and a line over
  1 MiB is dropped without growing memory: Sonolith never sends one, so it is reported as a protocol problem.
- Responses are matched by `id` (they may come in any order); everything with a `method` and no `id` is an event.
  Unknown fields and unknown events are ignored by the consumer.
- At most 16 requests are in flight (section 4.3). Cancelling a call (for example, the user pressing Esc) forgets
  its id; a late answer is then dropped.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable

from .discovery import MAX_MESSAGE
from .errors import ConnectionClosed, RpcError, SonolithError

MAX_IN_FLIGHT = 16
DEFAULT_TIMEOUT = 35.0  # Sonolith answers every request within 30 s (section 12)

EventHandler = Callable[[str, dict], None]
TraceHandler = Callable[[str, str, Any], None]  # (direction, method or kind, details)


class RequestTooLarge(SonolithError):
    def user_message(self) -> str:
        return "That request is too large to send (over 1 MiB)."


class CallTimeout(SonolithError):
    def user_message(self) -> str:
        return "Sonolith didn't answer in time."


def _redact(method: str, params: Any) -> Any:
    """Params as they may appear in the log: never the token (section 7.2)."""
    if isinstance(params, dict) and "token" in params:
        return {**params, "token": "<redacted>"}
    return params


class LineBuffer:
    """Splits a byte stream into lines, with a size cap. Pure: no I/O, so the framing can be tested on its own."""

    def __init__(self, limit: int = MAX_MESSAGE) -> None:
        self.limit = limit
        self._buf = bytearray()
        self._discarding = False
        self.oversized = 0

    def feed(self, data: bytes) -> list[bytes]:
        lines: list[bytes] = []
        start = 0
        while True:
            nl = data.find(b"\n", start)
            if nl < 0:
                break
            chunk = data[start:nl]
            start = nl + 1
            if self._discarding:
                self._discarding = False
                self._buf.clear()
                continue
            if len(self._buf) + len(chunk) > self.limit + 1:  # + 1: a trailing \r is not counted
                self._buf.clear()
                self.oversized += 1
                continue
            self._buf += chunk
            line = bytes(self._buf)
            self._buf.clear()
            if line.endswith(b"\r"):
                line = line[:-1]
            if len(line) > self.limit:
                self.oversized += 1
                continue
            if line.strip():
                lines.append(line)
        rest = data[start:]
        if self._discarding:
            return lines
        if len(self._buf) + len(rest) > self.limit + 1:
            self._buf.clear()
            self._discarding = True
            self.oversized += 1
        else:
            self._buf += rest
        return lines


class Connection:
    """A connection with request/response matching. Events go to `on_event` in arrival order."""

    def __init__(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
        on_event: EventHandler | None = None,
        on_trace: TraceHandler | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self._reader = reader
        self._writer = writer
        self.on_event = on_event
        self.on_trace = on_trace
        self.timeout = timeout
        self._next_id = 1
        self._pending: dict[int, tuple[str, asyncio.Future]] = {}
        self._slots = asyncio.Semaphore(MAX_IN_FLIGHT)
        self.closed = asyncio.Event()
        self.protocol_problems = 0
        self._lines = LineBuffer()
        self._task = asyncio.ensure_future(self._read_loop())

    # ------------------------------------------------------------ calls

    async def call(self, method: str, params: dict | None = None, timeout: float | None = None) -> Any:
        """Sends a request and waits for its answer. Raises RpcError for an error answer."""
        if self.closed.is_set():
            raise ConnectionClosed("closed")
        async with self._slots:
            msg_id = self._next_id
            self._next_id += 1
            msg: dict[str, Any] = {"jsonrpc": "2.0", "id": msg_id, "method": method}
            if params is not None:
                msg["params"] = params
            line = json.dumps(msg, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            if len(line) > MAX_MESSAGE:
                raise RequestTooLarge(method)
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            self._pending[msg_id] = (method, fut)
            self._trace("->", method, _redact(method, params))
            try:
                self._writer.write(line + b"\n")
                await self._writer.drain()
                return await asyncio.wait_for(fut, timeout if timeout is not None else self.timeout)
            except asyncio.TimeoutError:
                raise CallTimeout(method) from None
            except (ConnectionError, OSError) as e:
                raise ConnectionClosed(str(e)) from e
            finally:
                self._pending.pop(msg_id, None)

    def notify(self, method: str, params: dict | None = None) -> None:
        """A request without id (never answered). Not used by the app; SPEC 4.1 says clients SHOULD send an id."""
        msg: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        self._writer.write(json.dumps(msg, separators=(",", ":")).encode() + b"\n")

    @property
    def in_flight(self) -> int:
        return len(self._pending)

    # ------------------------------------------------------------ reading

    async def _read_loop(self) -> None:
        try:
            while True:
                data = await self._reader.read(65536)
                if not data:
                    break
                before = self._lines.oversized
                for line in self._lines.feed(data):
                    self._handle_line(line)
                if self._lines.oversized != before:
                    self.protocol_problems += self._lines.oversized - before
                    self._trace("!!", "protocol", "dropped a message over 1 MiB")
        except (ConnectionError, OSError, asyncio.IncompleteReadError):
            pass
        except asyncio.CancelledError:
            pass
        finally:
            self.closed.set()
            for method, fut in list(self._pending.values()):
                if not fut.done():
                    fut.set_exception(ConnectionClosed(method))
            self._pending.clear()

    def _handle_line(self, line: bytes) -> None:
        try:
            msg = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self.protocol_problems += 1
            self._trace("!!", "protocol", "a line that is not JSON")
            return
        if not isinstance(msg, dict):
            self.protocol_problems += 1
            return
        if "method" in msg and "id" not in msg:
            method = msg.get("method")
            params = msg.get("params")
            if isinstance(method, str):
                self._trace("<-", method, params)
                if self.on_event is not None:
                    try:
                        self.on_event(method, params if isinstance(params, dict) else {})
                    except Exception as e:  # a bug in a handler must not end the connection
                        self._trace("!!", "handler", repr(e))
            return
        msg_id = msg.get("id")
        entry = self._pending.get(msg_id) if isinstance(msg_id, int) else None
        if entry is None:
            if msg_id is None and isinstance(msg.get("error"), dict):
                # An error about a line Sonolith couldn't read (ParseError, messageTooLarge): id null.
                self._trace("<-", "error", msg["error"])
            return
        method, fut = entry
        if fut.done():
            return
        if isinstance(msg.get("error"), dict):
            self._trace("<-", method, {"error": msg["error"].get("data") or msg["error"]})
            fut.set_exception(RpcError(msg["error"], method))
        else:
            self._trace("<-", method, "ok")
            fut.set_result(msg.get("result"))

    def _trace(self, direction: str, what: str, details: Any) -> None:
        if self.on_trace is not None:
            try:
                self.on_trace(direction, what, details)
            except Exception:
                pass

    # ------------------------------------------------------------ closing

    def close(self) -> None:
        try:
            self._writer.close()
        except Exception:
            pass
        self._task.cancel()

    async def wait_closed(self) -> None:
        await self.closed.wait()
