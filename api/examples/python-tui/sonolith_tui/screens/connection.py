"""The connection (SPEC section 6 "Registration and consent", section 7 "Tokens and sessions", section 8 "Scopes",
section 9.1 "The app disconnects itself", section 12.1 "Rate limits", section 18 "Integration checklist").

Shows the connection state, what this app asked for and was granted, and a log of recent calls and events. Connect
asks Sonolith only because you pressed a key; nothing here asks on its own.
"""

from __future__ import annotations

import time

from .. import scopes as sc
from ..lists import Line
from ..session import Phase
from ..state import fmt_ms
from .base import View


class ConnectionView(View):
    title = "Connection"
    keys = [
        ("c", "connect to Sonolith (asks you in Sonolith the first time)"),
        ("k", "cancel a request that is waiting in Sonolith"),
        ("P", "ask for the permissions this app doesn't have yet"),
        ("D", "disconnect from Sonolith (removes this app there and forgets its access)"),
        ("L", "show / hide the log of calls and events"),
    ]

    def __init__(self, app) -> None:
        super().__init__(app)
        self.show_log = False

    def render(self, width: int, height: int) -> list[Line]:
        s = self.app.session.status
        st = self.app.store
        out: list[Line] = [(f"State: {s.phase.value}", "bold")]
        if s.message:
            out.append((s.message, ""))
        left = s.remaining_ms()
        if left is not None and s.phase in (Phase.DENIED, Phase.UNAVAILABLE):
            what = "You can ask again in" if s.phase == Phase.DENIED else "Trying again in"
            out.append((f"{what} {fmt_ms(left)}", ""))
        if s.phase in (Phase.NOT_CONNECTED, Phase.DENIED) and not left:
            out.append(("Press c to connect.", ""))
        if s.phase in (Phase.REGISTERING, Phase.IDENTITY):
            out.append(("Answer the request in Sonolith. Press k to cancel it.", ""))
        if s.app_version:
            out.append((f"Sonolith {s.app_version}, API {s.api_version}", ""))
        if st.signed_in is not None:
            out.append((f"Signed in to YouTube: {'yes' if st.signed_in else 'no'}", ""))
        path = self.app.session.tokens.path
        mode = self.app.session.tokens.mode()
        out.append((f"Access is stored in {path}" + (f" (mode {mode:o})" if mode is not None else " (none yet)"), ""))
        out.append(("", ""))
        out.append(("Permissions ([x] granted, [ ] not granted):", "bold"))
        for info in sc.SCOPES:
            mark = "x" if info.scope in st.granted else " "
            need = "required" if info.required else "optional"
            out.append((f"  [{mark}] {info.label} ({need}{', changes your account' if info.sensitive else ''})", ""))
        if self.show_log:
            out.append(("", ""))
            out.append(("Recent calls and events (newest last):", "bold"))
            room = max(1, height - len(out))
            for e in list(st.log)[-room:]:
                stamp = time.strftime("%H:%M:%S", time.localtime(e.at))
                out.append((f"{stamp} {e.direction} {e.what} {e.details}", ""))
        else:
            out.append(("", ""))
            out.append(("Press L to show the log of calls and events.", ""))
        return out

    def on_key(self, key: str) -> bool:
        app, session = self.app, self.app.session
        if key == "c":
            if session.connect():
                app.say("Connecting...")
        elif key == "k":
            session.cancel_registration()
        elif key == "P":
            app.request_missing(tuple(s.scope for s in sc.SCOPES))
        elif key == "D":
            app.confirm("Disconnect from Sonolith? This app is removed there and forgets its access; "
                        "to use it again you'll be asked again.", lambda: app.run(session.disconnect()))
        elif key == "L":
            self.show_log = not self.show_log
        else:
            return False
        return True
