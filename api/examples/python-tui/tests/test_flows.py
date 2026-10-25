"""The app driven by key presses against the fake server, without a terminal: registration, a denial countdown, a
revocation, a missing permission, and queue and playlist changes that ask first."""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from sonolith_tui.app import App
from sonolith_tui.backoff import Backoff
from sonolith_tui.session import Phase, Session
from sonolith_tui.token_store import FileTokenStore

from tests.fake_server import FakeSonolith


async def until(check, timeout: float = 3.0) -> None:
    for _ in range(int(timeout / 0.02)):
        if check():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("timed out")


class Flows(unittest.IsolatedAsyncioTestCase):
    async def start(self, **server_args) -> App:
        self.server = FakeSonolith(**server_args)
        await self.server.start()
        self.tokens = FileTokenStore(Path(tempfile.mkdtemp()) / "token")
        session = Session(self.tokens, opener=self.server.opener, backoff=Backoff(first=0.05, maximum=0.2))
        self.app = App(session)
        self.app.start()
        return self.app

    async def asyncTearDown(self) -> None:
        await self.app.stop()
        await self.server.stop()

    def screen(self) -> str:
        return "\n".join(text for text, _ in self.app.render(100, 40))

    def keys(self, *keys: str) -> None:
        for k in keys:
            self.app.key(k)

    async def connect(self) -> None:
        self.keys("6", "c")
        await until(lambda: self.app.session.status.phase == Phase.CONNECTED)

    async def test_first_registration_stores_the_token_privately_and_says_hello(self) -> None:
        app = await self.start()
        self.assertIn("[6 Connection]", self.screen(), "without a token the app opens on Connection")
        self.assertEqual(self.server.called("app.register"), [], "never registers without a key press")
        await self.connect()
        reg = self.server.called("app.register")[0]
        self.assertTrue(all(s["reason"] for s in reg["scopes"]))
        self.assertEqual(self.tokens.load(), "snl_test_token")
        self.assertEqual(self.tokens.mode(), 0o600)
        self.assertEqual(len(self.server.called("session.hello")), 1)
        self.assertIn("[x] Show lyrics", self.screen())
        self.keys("1")
        await until(lambda: "Song 0" in self.screen())

    async def test_a_denial_shows_a_countdown_and_holds_asking(self) -> None:
        await self.start(consent="denied", retry_ms=60_000)
        self.keys("6", "c")
        await until(lambda: self.app.session.status.phase == Phase.DENIED)
        self.assertRegex(self.screen(), r"can ask again in (1:00|0:59)")
        self.keys("c")
        self.assertIn("You can ask again in", self.app.message)
        await asyncio.sleep(0.1)
        self.assertEqual(len(self.server.called("app.register")), 1)

    async def test_a_revocation_deletes_the_token_and_does_not_register_again(self) -> None:
        await self.start()
        await self.connect()
        await self.server.push("session.revoked", {"reason": "removed"})
        await until(lambda: self.app.session.status.phase == Phase.NOT_CONNECTED)
        self.assertIsNone(self.tokens.load())
        self.assertIn("you removed this app", self.screen())
        await asyncio.sleep(0.3)
        self.assertEqual(len(self.server.called("app.register")), 1)

    async def test_a_missing_permission_shows_not_allowed_and_can_be_asked_for(self) -> None:
        await self.start(granted=["player:read"])
        await self.connect()
        self.keys("3")
        self.assertIn("Not allowed", self.screen())
        self.assertEqual(self.server.called("queue.get"), [])
        self.keys("P")
        await until(lambda: self.server.called("app.requestScopes"))
        asked = [s["scope"] for s in self.server.called("app.requestScopes")[0]["scopes"]]
        self.assertEqual(asked, ["queue:read"])

    async def test_queue_changes_ask_before_clearing(self) -> None:
        await self.start()
        await self.connect()
        self.keys("3")
        await until(lambda: "Song 2" in self.screen())
        self.keys("C")
        self.assertIn("Clear the queue?", self.screen())
        self.keys("n")
        await asyncio.sleep(0.05)
        self.assertEqual(self.server.called("queue.clear"), [])
        self.keys("C", "y")
        await until(lambda: self.server.called("queue.clear"))
        self.keys("KEY_DOWN", "d")
        await until(lambda: self.server.called("queue.remove"))
        self.assertEqual(self.server.called("queue.remove")[0], {"entryIds": ["e1"]})

    async def test_removing_one_copy_from_a_playlist_names_its_entry(self) -> None:
        await self.start()
        await self.connect()
        self.keys("4")
        await until(lambda: "Mine" in self.screen())
        self.keys("enter")
        await until(lambda: "yours, can be edited" in self.screen())
        self.keys("KEY_DOWN", "d")
        self.assertIn("Only this copy goes", self.screen())
        self.keys("y")
        await until(lambda: self.server.called("playlist.removeTracks"))
        self.assertEqual(self.server.called("playlist.removeTracks")[0], {"id": "PL1", "entryIds": ["p1"]})

    async def test_disconnect_unregisters_and_forgets_the_token(self) -> None:
        await self.start()
        await self.connect()
        self.keys("6", "D", "y")
        await until(lambda: self.server.called("app.unregister"))
        await until(lambda: self.tokens.load() is None)
        self.assertEqual(self.app.session.status.phase, Phase.NOT_CONNECTED)


if __name__ == "__main__":
    unittest.main()
