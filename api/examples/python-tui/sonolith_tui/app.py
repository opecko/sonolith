"""The app without the terminal: screens, keys, prompts, and calls that never block (SPEC section 4.3 "Order and
concurrency", section 11 "Errors", section 18 "Integration checklist").

Every call runs as its own asyncio task, so the screen keeps updating while Sonolith or YouTube answers; Esc cancels
the calls in flight. Errors become one readable sentence on the message line, never a traceback. The terminal side
(`terminal.py`) only feeds keys in and paints `render()` out, so tests can drive this class without a terminal.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from .errors import user_message
from .lists import Line
from .scopes import label
from .session import Phase, Session, Status
from .state import Store, fmt_ms
from .token_store import FileTokenStore
from .screens.base import View
from .screens.connection import ConnectionView
from .screens.library import LibraryView
from .screens.lyrics import LyricsView
from .screens.now_playing import NowPlayingView
from .screens.queue import QueueView
from .screens.search import SearchView

GLOBAL_KEYS = [
    ("1-6", "switch screens"),
    ("Space", "play / pause (on any screen)"),
    ("Esc", "cancel calls in flight, or go back"),
    ("?", "this help"),
    ("q", "quit (stays connected: the next start says hello again)"),
]


@dataclass
class Prompt:
    """A line of input at the bottom, or a yes/no question."""

    label: str
    on_done: Callable[[str], None]
    text: str = ""
    confirm: bool = False
    on_change: Callable[[str], None] | None = None
    completions: list[str] = field(default_factory=list)
    _completion: int = -1


class App:
    def __init__(self, session: Session | None = None, tokens: Any = None) -> None:
        self.store = Store()
        self.session = session or Session(tokens or FileTokenStore())
        self.session.on_status = self._on_status
        self.session.on_event = self._on_event
        self.session.on_notice = lambda text, _severity: self.say(text)
        self.session.on_trace = self.store.add_log
        self.views: list[View] = [
            NowPlayingView(self), LyricsView(self), QueueView(self), LibraryView(self), SearchView(self),
            ConnectionView(self),
        ]
        self.tab = 0 if self.session.tokens.load() else 5
        self.stack: list[View] = []
        self.message = ""
        self.prompt: Prompt | None = None
        self.help = False
        self.quit = False
        self.tasks: set[asyncio.Task] = set()
        self.quiet: set[asyncio.Task] = set()  # background calls (suggestions) that don't count as "working"
        self._phase = self.session.status.phase

    # ------------------------------------------------------------ lifecycle

    def start(self) -> None:
        self.session.start()

    async def stop(self) -> None:
        for t in list(self.tasks):
            t.cancel()
        await self.session.stop()

    # ------------------------------------------------------------ for the screens

    @property
    def view(self) -> View:
        return self.stack[-1] if self.stack else self.views[self.tab]

    def say(self, text: str) -> None:
        self.message = text

    def push(self, view: View) -> None:
        self.stack.append(view)

    def pop(self) -> None:
        if self.stack:
            self.stack.pop()

    def call(self, method: str, params: dict | None = None, done: Callable[[Any], None] | None = None, *,
             on_error: Callable[[], None] | None = None, quiet: bool = False, delay: float = 0) -> asyncio.Task:
        """Calls a method in the background; `done` gets the result. Failures go to the message line."""

        async def run() -> None:
            try:
                if delay:
                    await asyncio.sleep(delay)
                result = await self.session.call(method, params or {})
            except asyncio.CancelledError:
                if on_error:
                    on_error()
                if not quiet:
                    self.say(f"Cancelled ({method}).")
                raise
            except Exception as e:  # noqa: BLE001 - every failure becomes a sentence
                if on_error:
                    on_error()
                if not quiet:
                    self.say(user_message(e))
                return
            if done is not None:
                try:
                    done(result)
                except Exception as e:  # noqa: BLE001 - a surprising answer must not end the app
                    self.say(f"Couldn't show Sonolith's answer to {method} ({type(e).__name__}).")

        return self.run(run(), quiet=quiet)

    def run(self, coro: Awaitable[Any], quiet: bool = False) -> asyncio.Task:
        """Runs a coroutine in the background, turning failures into a message."""

        async def guarded() -> None:
            try:
                await coro
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                self.say(user_message(e))

        task = asyncio.ensure_future(guarded())
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        if quiet:
            self.quiet.add(task)
            task.add_done_callback(self.quiet.discard)
        return task

    def ask(self, label_text: str, on_done: Callable[[str], None], initial: str = "",
            on_change: Callable[[str], None] | None = None) -> None:
        self.prompt = Prompt(label_text, on_done, initial, on_change=on_change)

    def confirm(self, question: str, action: Callable[[], Any]) -> None:
        self.prompt = Prompt(question, lambda answer: action() if answer == "y" else self.say("Nothing changed."),
                             confirm=True)

    def request_missing(self, scopes: tuple[str, ...]) -> None:
        """Asks Sonolith for the scopes this app doesn't have (SPEC 6.5); only ever because the user pressed P."""
        missing = [s for s in scopes if s not in self.store.granted]
        if self.session.status.phase != Phase.CONNECTED:
            self.say("Connect first (screen 6, then c).")
        elif not missing:
            self.say("This app already has every permission it asks for.")
        else:
            self.run(self.session.request_scopes(missing))

    # ------------------------------------------------------------ session callbacks

    def _on_status(self, status: Status) -> None:
        was_granted = self.store.granted
        self.store.granted = status.granted
        if status.signed_in is not None:
            self.store.signed_in = status.signed_in
        connected = status.phase == Phase.CONNECTED
        if self._phase == Phase.CONNECTED and not connected:
            self.store.reset_live()
        if connected and (self._phase != Phase.CONNECTED or status.granted != was_granted):
            self.view.on_show()
        self._phase = status.phase

    def _on_event(self, method: str, params: dict) -> None:
        self.store.apply(method, params)
        for v in self.views + self.stack:
            v.on_event(method, params)

    # ------------------------------------------------------------ keys

    def key(self, key: str) -> None:
        if self.prompt is not None:
            self._prompt_key(key)
            return
        if self.help:
            self.help = False
            return
        if key == "esc":
            busy = self.tasks - self.quiet
            if busy:
                for t in busy:
                    t.cancel()
            elif self.stack:
                self.stack.pop()
            return
        if key == "?":
            self.help = True
            return
        if key == "q":
            self.quit = True
            return
        if key in "123456" and len(key) == 1:
            self.tab = int(key) - 1
            self.stack.clear()
            if self._ready():
                self.view.on_show()
            return
        view = self.view
        if not self._ready():
            if isinstance(view, ConnectionView):
                view.on_key(key)
            return
        if not view.allowed():
            if key == "P":
                self.request_missing(view.scopes)
            return
        if view.on_key(key):
            return
        if key == " ":
            self.call("player.toggle")

    def _ready(self) -> bool:
        return self.session.status.phase == Phase.CONNECTED

    def _prompt_key(self, key: str) -> None:
        p = self.prompt
        assert p is not None
        if p.confirm:
            self.prompt = None
            p.on_done("y" if key in ("y", "Y") else "n")
            return
        if key == "esc":
            self.prompt = None
        elif key == "enter":
            self.prompt = None
            p.on_done(p.text)
        elif key == "backspace":
            p.text = p.text[:-1]
            self._changed(p)
        elif key == "tab" and p.completions:
            p._completion = (p._completion + 1) % len(p.completions)
            p.text = p.completions[p._completion]
        elif len(key) == 1 and key.isprintable():
            p.text += key
            self._changed(p)

    @staticmethod
    def _changed(p: Prompt) -> None:
        p._completion = -1
        if p.on_change:
            p.on_change(p.text)

    # ------------------------------------------------------------ drawing

    def render(self, width: int, height: int) -> list[Line]:
        """The whole screen as `height` lines of plain text with a style each."""
        s = self.session.status
        state = s.phase.value
        left = s.remaining_ms()
        if left is not None and s.phase in (Phase.DENIED, Phase.UNAVAILABLE):
            state += f" ({'can ask again' if s.phase == Phase.DENIED else 'retrying'} in {fmt_ms(left)})"
        busy = len(self.tasks - self.quiet)
        top = f"Sonolith TUI | {state}" + (f" | working on {busy} call(s), Esc cancels" if busy else "")
        names = [v.title for v in self.views]
        tabs = "  ".join(f"[{i + 1} {n}]" if i == self.tab else f"{i + 1} {n}" for i, n in enumerate(names))
        lines: list[Line] = [(top, "bold"), (tabs, ""), ("-" * (width - 1), "")]
        body = height - len(lines) - 2
        view = self.view
        if self.help:
            content = self._help()
        elif not self._ready() and not isinstance(view, ConnectionView):
            content = [("Not connected to Sonolith.", "bold"), ("", ""), (s.message or "Press 6, then c to connect.", "")]
        elif not view.allowed():
            content = view.not_allowed()
        else:
            title = [(f"{view.title}", "bold")] if self.stack else []
            content = title + view.render(width, body - len(title))
        content = content[:body] + [("", "")] * max(0, body - len(content))
        lines += content
        lines.append((self.message, ""))
        lines.append(self._bottom(view))
        return [(text[: max(0, width - 1)], style) for text, style in lines]

    def _bottom(self, view: View) -> Line:
        p = self.prompt
        if p is not None:
            if p.confirm:
                return (f"{p.label} [y/N] ", "reverse")
            return (f"{p.label}: {p.text}_   (Enter ok, Esc cancel{', Tab suggestion' if p.completions else ''})", "reverse")
        hints = "  ".join(f"{k} {' '.join(what.split(' (')[0].split()[:2])}" for k, what in view.keys[:5])
        return (f"? help  q quit  {hints}", "reverse")

    def _help(self) -> list[Line]:
        out: list[Line] = [("Keys everywhere", "bold")]
        out += [(f"  {k:<18} {what}", "") for k, what in GLOBAL_KEYS]
        out += [("", ""), (f"Keys on {self.view.title}", "bold")]
        out += [(f"  {k:<18} {what}", "") for k, what in self.view.keys]
        if self.view.scopes:
            out += [("", ""), (f"Needs: {' or '.join(label(s) for s in self.view.scopes)}", "")]
        out += [("", ""), ("Press any key to close.", "")]
        return out
