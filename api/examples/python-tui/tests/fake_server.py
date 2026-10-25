"""A tiny stand-in for Sonolith on a Unix socket, for the tests: newline-delimited JSON-RPC, registration with a
scripted answer, sessions, events, and canned answers for the methods the screens call. It records every call."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from typing import Any

TRACK = lambda i: {"type": "track", "id": f"t{i}", "title": f"Song {i}", "artists": [{"id": None, "name": "Band"}],  # noqa: E731
                   "album": None, "durationMs": 200_000, "thumbnailUrl": None, "explicit": False, "video": False,
                   "rating": None}


class FakeSonolith:
    def __init__(self, consent: str = "approved", granted: list[str] | None = None, retry_ms: int = 60_000) -> None:
        self.consent = consent
        self.granted = granted
        self.retry_ms = retry_ms
        self.calls: list[tuple[str, dict]] = []
        self.token = "snl_test_token"
        self.writers: list[asyncio.StreamWriter] = []
        self.dir = tempfile.mkdtemp(prefix="snl-tui-")
        self.path = os.path.join(self.dir, "api.sock")
        self.server: asyncio.AbstractServer | None = None
        self.queue = [{"index": i, "entryId": f"e{i}", "item": TRACK(i), "autoplay": False} for i in range(3)]
        # A playlist with the same song twice: removal must name the selected copy's entry id.
        self.playlist = [{"entryId": "p0", "item": TRACK(1)}, {"entryId": "p1", "item": TRACK(1)}]

    async def start(self) -> None:
        self.server = await asyncio.start_unix_server(self._serve, self.path)

    async def stop(self) -> None:
        for w in self.writers:
            w.close()
        if self.server:
            self.server.close()

    async def opener(self):
        return await asyncio.open_unix_connection(self.path)

    def called(self, method: str) -> list[dict]:
        return [p for m, p in self.calls if m == method]

    async def push(self, method: str, params: dict) -> None:
        for w in list(self.writers):
            self._send(w, {"jsonrpc": "2.0", "method": method, "params": params})
            await w.drain()

    @staticmethod
    def _send(w: asyncio.StreamWriter, msg: dict) -> None:
        w.write(json.dumps(msg).encode() + b"\n")

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.writers.append(writer)
        try:
            while line := await reader.readline():
                msg = json.loads(line)
                method, params, mid = msg.get("method"), msg.get("params") or {}, msg.get("id")
                self.calls.append((method, params))
                result, error, after = self._answer(method, params)
                reply: dict[str, Any] = {"jsonrpc": "2.0", "id": mid}
                if error:
                    reply["error"] = {"code": -32000, "message": error["name"], "data": {"reason": None, **error}}
                else:
                    reply["result"] = result
                self._send(writer, reply)
                for event in after:
                    self._send(writer, {"jsonrpc": "2.0", "method": event[0], "params": event[1]})
                await writer.drain()
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            if writer in self.writers:
                self.writers.remove(writer)
            writer.close()

    def _answer(self, method: str, p: dict) -> tuple[Any, dict | None, list]:
        scopes = self.granted if self.granted is not None else [s["scope"] for s in p.get("scopes", [])]
        if method == "app.register":
            outcome = {"requestId": "req_1", "kind": "register", "status": self.consent, "token": None,
                       "grantedScopes": None, "retryAfterMs": None}
            if self.consent == "approved":
                self.granted = scopes
                outcome.update(token=self.token, grantedScopes=scopes)
            elif self.consent in ("denied", "expired"):
                outcome["retryAfterMs"] = self.retry_ms
            pending = {"status": "pending", "requestId": "req_1", "expiresAt": 0, "identity": None}
            return pending, None, [("registration.resolved", outcome)]
        if method == "session.hello":
            if p.get("token") != self.token:
                return None, {"name": "Unauthorized"}, []
            return {"apiVersion": "1.0.0", "appVersion": "9.9.9", "appId": p["appId"], "grantedScopes": self.granted,
                    "signedIn": True, "identity": None}, None, []
        if method == "events.subscribe":
            state = {"status": "paused", "item": TRACK(0), "positionMs": 0, "positionAt": 0, "durationMs": 200_000,
                     "volume": 50, "muted": False, "shuffle": False, "repeat": "off", "rate": 1, "episodeRate": 1,
                     "canGoNext": True, "canGoPrevious": True, "queueIndex": 0, "queueLength": 3, "autoplay": True}
            events = [("player.stateChanged", state)] if "player.state" in p.get("topics", []) else []
            return {"topics": p.get("topics", []), "positionHz": 2}, None, events
        if method == "app.requestScopes":
            return {"status": "pending", "requestId": "req_2", "expiresAt": 0, "grantedScopes": self.granted}, None, []
        if method == "queue.get":
            return {"revision": 1, "currentIndex": 0, "length": len(self.queue), "autoplay": True,
                    "items": self.queue, "nextCursor": None}, None, []
        if method == "library.playlists":
            return {"items": [{"type": "playlist", "id": "PL1", "title": "Mine", "author": None, "trackCount": 2,
                               "thumbnailUrl": None, "editable": True}], "nextCursor": None}, None, []
        if method == "playlist.get":
            return {"playlist": {"type": "playlist", "id": p["id"], "title": "Mine", "author": None, "trackCount": 2,
                                 "thumbnailUrl": None, "editable": True, "description": None, "privacy": "private"},
                    "items": self.playlist, "nextCursor": None}, None, []
        if method == "playlist.removeTracks":
            return {"removed": 1}, None, []
        if method == "app.unregister":
            return {}, None, []
        return {}, None, []


def free_runtime_dir() -> str:
    return tempfile.mkdtemp(prefix="snl-tui-tok-")
