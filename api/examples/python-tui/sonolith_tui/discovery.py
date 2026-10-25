"""Finding and opening Sonolith's endpoint (SPEC section 3 "Transport": 3.1 Linux, 3.2 Windows, 3.3 Discovery).

1. Read `discovery.json` and connect to its `path`.
2. On Linux only, if there is no discovery file, try the default socket path.
3. Otherwise Sonolith is not available (section 3.4).

Linux uses the Unix socket `$XDG_RUNTIME_DIR/sonolith/api.sock` (fallback `/tmp/sonolith-<uid>/`, which must be owned
by us with mode 0700). Windows uses the named pipe from `discovery.json` only and checks that the pipe's server
process is the `pid` in that file before any token is sent. Windows support is untested.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from .errors import NotAvailable

WINDOWS = sys.platform == "win32"
MAX_MESSAGE = 1024 * 1024  # section 4.2: at most 1 MiB per message, without the line feed


@dataclass(frozen=True)
class Endpoint:
    transport: str  # "unix" or "pipe"
    path: str
    pid: int | None
    api_version: str | None
    app_version: str | None


def runtime_dir() -> Path:
    """`$XDG_RUNTIME_DIR/sonolith`, or the `/tmp/sonolith-<uid>` fallback after checking it is private (3.1)."""
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        return Path(xdg) / "sonolith"
    d = Path(f"/tmp/sonolith-{os.getuid()}")
    try:
        st = d.lstat()
    except FileNotFoundError:
        return d
    if st.st_uid != os.getuid() or (st.st_mode & 0o777) != 0o700:
        raise NotAvailable(f"{d} is not private to this user; refusing to connect")
    return d


def discovery_file() -> Path:
    if WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA", "")) / "Sonolith" / "api" / "discovery.json"
    return runtime_dir() / "discovery.json"


def discover() -> Endpoint:
    """Where Sonolith listens. Raises NotAvailable when there is nothing to try."""
    try:
        info = json.loads(discovery_file().read_text(encoding="utf-8"))
        if not isinstance(info, dict) or not isinstance(info.get("path"), str):
            raise ValueError("no path")
        pid = info.get("pid") if isinstance(info.get("pid"), int) else None
        transport = info.get("transport") if isinstance(info.get("transport"), str) else ("pipe" if WINDOWS else "unix")
        return Endpoint(transport, info["path"], pid, info.get("apiVersion"), info.get("appVersion"))
    except (FileNotFoundError, NotADirectoryError, ValueError, OSError):
        if WINDOWS:
            # Windows clients must not build the pipe name themselves (3.2).
            raise NotAvailable("no discovery.json") from None
        return Endpoint("unix", str(runtime_dir() / "api.sock"), None, None, None)


async def open_stream(endpoint: Endpoint) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """Opens the endpoint. Every failure to reach it is NotAvailable; a stale socket file is never deleted (3.5)."""
    try:
        if endpoint.transport == "unix":
            if WINDOWS:
                raise NotAvailable("a Unix socket endpoint on Windows")
            return await asyncio.open_unix_connection(endpoint.path, limit=2 * MAX_MESSAGE)
        loop = asyncio.get_running_loop()
        reader = asyncio.StreamReader(limit=2 * MAX_MESSAGE)
        create = getattr(loop, "create_pipe_connection", None)
        if create is None:
            raise NotAvailable("this event loop cannot open named pipes")
        transport, protocol = await create(lambda: asyncio.StreamReaderProtocol(reader), endpoint.path)
        _check_pipe_server(transport, endpoint.pid)
        return reader, asyncio.StreamWriter(transport, protocol, reader, loop)
    except NotAvailable:
        raise
    except (FileNotFoundError, ConnectionRefusedError, PermissionError, OSError) as e:
        raise NotAvailable(str(e)) from e


def _check_pipe_server(transport: asyncio.BaseTransport, pid: int | None) -> None:  # pragma: no cover - Windows
    """Windows: the pipe must belong to the Sonolith in discovery.json before a token is sent (3.2, section 14)."""
    if not pid:
        return
    import ctypes
    from ctypes import wintypes

    pipe = transport.get_extra_info("pipe")
    handle = getattr(pipe, "handle", None)
    if handle is None:
        return
    server = wintypes.ULONG()
    ok = ctypes.windll.kernel32.GetNamedPipeServerProcessId(wintypes.HANDLE(handle), ctypes.byref(server))  # type: ignore[attr-defined]
    if ok and server.value != pid:
        transport.close()
        raise NotAvailable(f"the pipe belongs to process {server.value}, not Sonolith ({pid})")
