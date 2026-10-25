#!/usr/bin/env python3
"""A complete Sonolith API client: connect, register, store the token, subscribe, handle revoke, unregister.

Standard library only (Python 3.9+). Uses the `keyring` package for the token when it is installed, otherwise a
file only the user can read.

    python3 sonolith_client.py register    # the user action: asks Sonolith for access, then runs
    python3 sonolith_client.py run         # connects with the stored token and prints events
    python3 sonolith_client.py status      # prints the current state once
    python3 sonolith_client.py disconnect  # "Disconnect from Sonolith": unregisters and deletes the token

Works on Linux (Unix socket) and Windows (named pipe).
"""

import asyncio
import json
import os
import random
import sys
from pathlib import Path

APP_ID = "com.example.sonolith-demo"
API_VERSION = "1.0"
REGISTRATION = {
    "appId": APP_ID,
    "name": "Sonolith Demo",
    "description": "An example client that prints what Sonolith is playing.",
    "publisher": "Sonolith API examples",
    "homepage": "https://github.com/opecko/sonolith/tree/master/api/examples",
    "scopes": [
        {"scope": "player:read", "required": True, "reason": "To print the current song"},
        {"scope": "lyrics:read", "required": False, "reason": "To print the current lyric line"},
    ],
    "apiVersion": API_VERSION,
}
MAX_MESSAGE = 1024 * 1024
WINDOWS = sys.platform == "win32"


# ---------------------------------------------------------------- token storage


class TokenStore:
    """The OS secret store when `keyring` is available, else a user-only file."""

    def __init__(self):
        try:
            import keyring  # type: ignore

            self.keyring = keyring
        except ImportError:
            self.keyring = None
        base = Path(os.environ.get("APPDATA", "")) if WINDOWS else Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        self.file = base / "sonolith-demo" / "token"

    def load(self):
        if self.keyring:
            return self.keyring.get_password("sonolith-api", APP_ID)
        try:
            return self.file.read_text().strip() or None
        except FileNotFoundError:
            return None

    def save(self, token):
        if self.keyring:
            self.keyring.set_password("sonolith-api", APP_ID, token)
            return
        self.file.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(token)

    def delete(self):
        if self.keyring:
            try:
                self.keyring.delete_password("sonolith-api", APP_ID)
            except Exception:
                pass
        self.file.unlink(missing_ok=True)


# ---------------------------------------------------------------- discovery and transport


class NotAvailable(Exception):
    """Sonolith is not running, or its API is off."""


def discovery_file():
    if WINDOWS:
        return Path(os.environ["LOCALAPPDATA"]) / "Sonolith" / "api" / "discovery.json"
    return runtime_dir() / "discovery.json"


def runtime_dir():
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        return Path(xdg) / "sonolith"
    d = Path(f"/tmp/sonolith-{os.getuid()}")
    st = d.lstat() if d.exists() else None
    if st and (st.st_uid != os.getuid() or st.st_mode & 0o077):
        raise NotAvailable(f"{d} is not private to this user; refusing to connect")
    return d


def discover():
    try:
        info = json.loads(discovery_file().read_text())
        return info["path"], info.get("pid")
    except (FileNotFoundError, KeyError, ValueError):
        if WINDOWS:
            raise NotAvailable("no discovery.json")  # Windows clients must not guess the pipe name
        return str(runtime_dir() / "api.sock"), None


async def open_stream(path, pid):
    try:
        if not WINDOWS:
            return await asyncio.open_unix_connection(path, limit=2 * MAX_MESSAGE)
        loop = asyncio.get_running_loop()
        reader = asyncio.StreamReader(limit=2 * MAX_MESSAGE)
        transport, protocol = await loop.create_pipe_connection(lambda: asyncio.StreamReaderProtocol(reader), path)
        check_pipe_server(transport, pid)
        return reader, asyncio.StreamWriter(transport, protocol, reader, loop)
    except (FileNotFoundError, ConnectionRefusedError, OSError) as e:
        raise NotAvailable(str(e)) from e


def check_pipe_server(transport, pid):
    """Windows: make sure the pipe belongs to the Sonolith in discovery.json before sending a token."""
    import ctypes
    from ctypes import wintypes

    handle = transport.get_extra_info("pipe").handle
    server = wintypes.ULONG()
    if pid and ctypes.windll.kernel32.GetNamedPipeServerProcessId(wintypes.HANDLE(handle), ctypes.byref(server)):
        if server.value != pid:
            transport.close()
            raise NotAvailable(f"pipe server is process {server.value}, not Sonolith ({pid})")


# ---------------------------------------------------------------- JSON-RPC connection


class RpcError(Exception):
    def __init__(self, error):
        self.code = error.get("code")
        self.data = error.get("data") or {}
        self.name = self.data.get("name", error.get("message"))
        super().__init__(f"{self.name} ({self.code}): {self.data.get('reason') or error.get('message')}")


class Connection:
    def __init__(self, reader, writer):
        self.reader, self.writer = reader, writer
        self.next_id = 1
        self.pending = {}
        self.events = asyncio.Queue()
        self.task = asyncio.ensure_future(self._read())

    @classmethod
    async def open(cls):
        return cls(*await open_stream(*discover()))

    async def call(self, method, params=None):
        msg_id, self.next_id = self.next_id, self.next_id + 1
        msg = {"jsonrpc": "2.0", "id": msg_id, "method": method}
        if params is not None:
            msg["params"] = params
        line = json.dumps(msg, separators=(",", ":")).encode() + b"\n"
        assert len(line) <= MAX_MESSAGE
        fut = asyncio.get_running_loop().create_future()
        self.pending[msg_id] = fut
        self.writer.write(line)
        await self.writer.drain()
        return await fut

    async def _read(self):
        try:
            while True:
                line = await self.reader.readline()
                if not line:
                    break
                if not line.strip():
                    continue
                msg = json.loads(line)
                if "id" in msg and msg["id"] in self.pending:
                    fut = self.pending.pop(msg["id"])
                    if "error" in msg:
                        fut.set_exception(RpcError(msg["error"]))
                    else:
                        fut.set_result(msg.get("result"))
                elif "method" in msg:
                    await self.events.put(msg)  # unknown notifications are ignored by the consumer
        except (ConnectionError, OSError, ValueError):
            pass
        finally:
            for fut in self.pending.values():
                if not fut.done():
                    fut.set_exception(NotAvailable("connection closed"))
            await self.events.put(None)  # end of stream

    async def next_event(self):
        return await self.events.get()

    def close(self):
        self.writer.close()


# ---------------------------------------------------------------- flows


def say(text):
    print(text, flush=True)


def wait_text(ms):
    """`retryAfterMs` for people: "40 s" or "10 min", rounded up."""
    seconds = -(-ms // 1000)
    return f"{seconds} s" if seconds < 60 else f"{-(-seconds // 60)} min"


async def register(store):
    """Asks the user for access. Call this only because the user asked (here: the `register` command)."""
    conn = await Connection.open()
    try:
        try:
            pending = await conn.call("app.register", REGISTRATION)
        except RpcError as e:
            if e.name == "Blocked":
                say("Sonolith blocked this app. You can unblock it in Sonolith's Settings → Connected apps.")
            elif e.name == "RegistrationDenied":
                say(f"Access was denied recently. You can try again in {wait_text(e.data['retryAfterMs'])}.")
            elif e.name == "RegistrationPending":
                say("A request from this app is already waiting. Answer it in Sonolith.")
            else:
                raise
            return False
        say("Waiting for you to approve “Sonolith Demo” in Sonolith…")
        while True:
            msg = await conn.next_event()
            if msg is None:
                raise NotAvailable("Sonolith closed the connection; the request was cancelled")
            if msg["method"] != "registration.resolved" or msg["params"]["requestId"] != pending["requestId"]:
                continue
            p = msg["params"]
            if p["status"] == "approved":
                store.save(p["token"])  # store first: it is sent only once
                say(f"Connected. Granted: {', '.join(p['grantedScopes'])}")
                return True
            if p["status"] == "blocked":
                say("Sonolith blocked this app. You can unblock it in Sonolith's Settings → Connected apps.")
            elif p["status"] == "denied":
                say(f"Access was denied. You can try again in {wait_text(p['retryAfterMs'])}.")
            else:
                say("Nobody answered in time. Run `register` again to retry.")
            return False
    finally:
        conn.close()


async def hello(conn, store, token):
    """Authenticates; returns the session, or None when the app lost its access."""
    while True:
        try:
            return await conn.call("session.hello", {"appId": APP_ID, "token": token, "apiVersion": API_VERSION})
        except RpcError as e:
            if e.name in ("Unauthorized", "NotRegistered", "Blocked"):
                store.delete()
                say("Disconnected from Sonolith." + (" (This app is blocked in Sonolith.)" if e.name == "Blocked" else ""))
                return None
            if e.name != "RegistrationPending":
                raise
            say("This app's executable changed; approve it again in Sonolith…")
            while True:
                msg = await conn.next_event()
                if msg is None:
                    raise NotAvailable("connection closed")
                if msg["method"] == "registration.resolved" and msg["params"]["requestId"] == e.data.get("requestId"):
                    break
            if msg["params"]["status"] != "approved":
                say("Not approved.")
                return None


def describe(item):
    if not item:
        return "nothing"
    if item["type"] == "episode":
        return f"{item['title']} ({(item['podcast'] or {}).get('title', 'podcast')})"
    return f"{item['title']} – {', '.join(a['name'] for a in item['artists'])}"


async def run(store):
    """Runs until revoked or interrupted, reconnecting with backoff."""
    delay = 1.0
    while True:
        token = store.load()
        if not token:
            say("Not connected to Sonolith. Run `register` to connect.")
            return
        try:
            conn = await Connection.open()
        except NotAvailable:
            say(f"Sonolith is not available (not running, or “Allow other apps to connect” is off). Retrying in {delay:.0f} s.")
            await asyncio.sleep(delay * random.uniform(0.8, 1.2))
            delay = min(delay * 2, 60)
            continue
        try:
            session = await hello(conn, store, token)
            if session is None:
                return
            delay = 1.0
            scopes = set(session["grantedScopes"])
            topics = ["player.track", "player.state"] + (["lyrics.line"] if "lyrics:read" in scopes else [])
            await conn.call("events.subscribe", {"topics": topics})
            while True:
                msg = await conn.next_event()
                if msg is None:
                    say("Sonolith went away.")
                    break
                method, p = msg["method"], msg.get("params", {})
                if method == "player.trackChanged":
                    say(f"♪ {describe(p['item'])}")
                elif method == "player.stateChanged":
                    say(f"  [{p['status']}]")
                elif method == "lyrics.line" and p["text"]:
                    say(f"  “{p['text']}”")
                elif method == "session.scopesChanged":
                    say(f"  scopes now: {', '.join(p['grantedScopes'])}")  # resubscribe on the next connection
                elif method == "session.revoked":
                    store.delete()
                    say("Disconnected from Sonolith.")
                    return
        except NotAvailable:
            say("Sonolith went away.")
        finally:
            conn.close()
        await asyncio.sleep(delay * random.uniform(0.8, 1.2))  # never reconnect in a tight loop
        delay = min(delay * 2, 60)


async def status(store):
    token = store.load()
    if not token:
        say("Not connected to Sonolith. Run `register` to connect.")
        return
    conn = await Connection.open()
    try:
        if await hello(conn, store, token):
            state = await conn.call("player.getState")
            say(f"{state['status']}: {describe(state['item'])} at {state['positionMs'] // 1000} s")
    finally:
        conn.close()


async def disconnect(store):
    """The "Disconnect from Sonolith" action: unregister, and delete the token in any case."""
    token = store.load()
    try:
        if token:
            conn = await Connection.open()
            try:
                if await hello(conn, store, token):
                    await conn.call("app.unregister")
            finally:
                conn.close()
    except (NotAvailable, RpcError) as e:
        say(f"Could not reach Sonolith ({e}); the app stays listed there until you remove it.")
    finally:
        store.delete()
    say("Disconnected from Sonolith.")


async def main(cmd):
    store = TokenStore()
    if cmd == "register":
        if await register(store):
            await run(store)
    elif cmd == "run":
        await run(store)
    elif cmd == "status":
        await status(store)
    elif cmd == "disconnect":
        await disconnect(store)
    else:
        say(__doc__)


if __name__ == "__main__":
    try:
        asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))
    except KeyboardInterrupt:
        pass
    except NotAvailable as e:
        say(f"Sonolith is not available: {e}")
        sys.exit(1)
