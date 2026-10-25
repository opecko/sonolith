"""Unit tests: framing, error messages, backoff, the token file, refs, lyrics timing. `python -m unittest` in the
example's folder runs them; nothing beyond the standard library."""

from __future__ import annotations

import asyncio
import os
import stat
import tempfile
import unittest
from pathlib import Path

from sonolith_tui.backoff import Backoff
from sonolith_tui.client import Connection, LineBuffer
from sonolith_tui.errors import RpcError, wait_text
from sonolith_tui.lists import ItemList, Row
from sonolith_tui.refs import MEDIA, parse_refs
from sonolith_tui.screens.lyrics import line_text
from sonolith_tui.screens.now_playing import progress_bar
from sonolith_tui.state import locate_lyrics, parse_time
from sonolith_tui.token_store import FileTokenStore

from tests.fake_server import FakeSonolith


class Framing(unittest.TestCase):
    def test_split_joined_and_crlf_lines(self) -> None:
        b = LineBuffer()
        self.assertEqual(b.feed(b'{"a":1}\n{"b"'), [b'{"a":1}'])
        self.assertEqual(b.feed(b':2}\r\n\n{"c":3}\n'), [b'{"b":2}', b'{"c":3}'])

    def test_an_oversized_line_is_dropped_and_the_next_one_kept(self) -> None:
        b = LineBuffer(limit=10)
        self.assertEqual(b.feed(b"x" * 8), [])
        self.assertEqual(b.feed(b"y" * 8), [])
        self.assertEqual(b.feed(b'\n{"ok":1}\n'), [b'{"ok":1}'])
        self.assertEqual(b.oversized, 1)


class Calls(unittest.IsolatedAsyncioTestCase):
    async def test_answers_and_errors_over_a_socket(self) -> None:
        server = FakeSonolith()
        await server.start()
        reader, writer = await server.opener()
        events: list[str] = []
        conn = Connection(reader, writer, on_event=lambda m, p: events.append(m))
        pending = await conn.call("app.register", {"scopes": [{"scope": "search"}]})
        self.assertEqual(pending["status"], "pending")
        with self.assertRaises(RpcError) as e:
            await conn.call("session.hello", {"appId": "x", "token": "wrong", "apiVersion": "1.0"})
        self.assertEqual(e.exception.name, "Unauthorized")
        self.assertIn("access ended", e.exception.user_message())
        self.assertEqual(events, ["registration.resolved"])
        conn.close()
        await server.stop()


class Messages(unittest.TestCase):
    def test_errors_read_like_sentences(self) -> None:
        denied = RpcError({"code": -32005, "data": {"name": "RegistrationDenied", "retryAfterMs": 42_000}})
        self.assertEqual(denied.user_message(), "Access was declined recently. You can ask again in 42 s.")
        perm = RpcError({"code": -32003, "data": {"name": "PermissionDenied", "scope": "queue:write"}})
        self.assertIn("Change your queue", perm.user_message())
        limited = RpcError({"code": -32009, "data": {"name": "RateLimited", "retryAfterMs": 1500}})
        self.assertIn("Try again in 2 s", limited.user_message())
        odd = RpcError({"code": -32099, "message": "Weird", "data": {"name": "SomethingNew"}})
        self.assertIn("SomethingNew", odd.user_message())

    def test_waits(self) -> None:
        self.assertEqual([wait_text(x) for x in (40_000, 60_000, 600_000, 3_600_000)], ["40 s", "1 min", "10 min", "1 h"])


class Backoffs(unittest.TestCase):
    def test_doubles_to_a_cap_and_resets(self) -> None:
        b = Backoff(first=1, maximum=8, rand=lambda lo, hi: 1.0)
        self.assertEqual([b.next_delay() for _ in range(5)], [1, 2, 4, 8, 8])
        self.assertEqual(b.next_delay(at_least=30), 30)
        b.reset()
        self.assertEqual(b.next_delay(), 1)


@unittest.skipIf(os.name == "nt", "POSIX permissions")
class Tokens(unittest.TestCase):
    def test_the_token_file_is_private(self) -> None:
        path = Path(tempfile.mkdtemp()) / "cfg" / "token"
        store = FileTokenStore(path)
        self.assertIsNone(store.load())
        store.save("snl_abc")
        self.assertEqual(store.load(), "snl_abc")
        self.assertEqual(store.mode(), 0o600)
        self.assertEqual(stat.S_IMODE(path.parent.stat().st_mode), 0o700)
        os.chmod(path, 0o644)
        self.assertEqual(store.load(), "snl_abc")
        self.assertEqual(store.mode(), 0o600, "a loosened file is tightened before it is read")
        store.delete()
        self.assertIsNone(store.load())


class Pure(unittest.TestCase):
    def test_refs(self) -> None:
        self.assertEqual(parse_refs("abc, album:MP1 nope:x"), ([{"type": "track", "id": "abc"}, {"type": "album", "id": "MP1"}], ["nope:x"]))
        self.assertEqual(parse_refs("album:MP1", MEDIA)[1], ["album:MP1"])

    def test_lyrics_timing_and_the_current_word(self) -> None:
        words = [{"startMs": 0, "endMs": 400, "text": "Hello "}, {"startMs": 400, "endMs": 900, "text": "world"}]
        lines = [{"startMs": 0, "endMs": 1000, "text": "Hello world", "words": words}, {"startMs": 2000, "endMs": None, "text": "Two"}]
        self.assertEqual(locate_lyrics(lines, 500), (0, 1))
        self.assertEqual(locate_lyrics(lines, 1500), (None, None))
        self.assertEqual(line_text(lines[0], 1), "Hello [world]")
        self.assertEqual(line_text(lines[0], 0), "[Hello] world")

    def test_times_and_bars(self) -> None:
        self.assertEqual(parse_time("1:23"), 83_000)
        self.assertIsNone(parse_time("soon"))
        self.assertEqual(progress_bar(50_000, 100_000, 30), "0:50 [========>---------] 1:40")

    def test_lists_skip_headers(self) -> None:
        lst = ItemList()
        lst.add_row(Row("Top result", selectable=False))
        lst.add_row(Row("a", {}))
        lst.add_row(Row("Results", selectable=False))
        lst.add_row(Row("b", {}))
        self.assertEqual(lst.selected.text, "a")
        lst.move(1)
        self.assertEqual(lst.selected.text, "b")


if __name__ == "__main__":
    unittest.main()
