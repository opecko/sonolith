"""Storing the client token (SPEC section 7.2 "Storing the token").

The SPEC prefers the platform's secret store. This example uses only the standard library, so it uses the
allowed fallback: a file only the user can read.

- Linux: `$XDG_CONFIG_HOME/sonolith-tui/token` (or `~/.config/sonolith-tui/token`), mode 0600 in a 0700 directory.
- Windows: `%APPDATA%\\sonolith-tui\\token`, inside the user's profile, which is private to the user by default.

The file is written atomically: a new file is created with `O_CREAT | O_EXCL` and mode 0600 (so it is never
readable by others, not even for a moment), then renamed over the old one. The token is never logged or shown.
To use a secret store instead, replace `FileTokenStore` with a class that has the same three methods.
"""

from __future__ import annotations

import os
import secrets
import stat
import sys
from pathlib import Path

WINDOWS = sys.platform == "win32"
DIR_NAME = "sonolith-tui"


def default_token_path() -> Path:
    if WINDOWS:
        base = Path(os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming"))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config"))
    return base / DIR_NAME / "token"


class FileTokenStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_token_path()

    def load(self) -> str | None:
        try:
            if not WINDOWS:
                st = self.path.stat()
                if st.st_uid != os.getuid():
                    return None  # not ours: never trust or use it
                if st.st_mode & 0o077:
                    os.chmod(self.path, 0o600)  # someone loosened it; tighten before reading
            token = self.path.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return None
        except OSError:
            return None
        return token or None

    def save(self, token: str) -> None:
        directory = self.path.parent
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        if not WINDOWS:
            st = directory.stat()
            if st.st_mode & 0o077 and st.st_uid == os.getuid():
                os.chmod(directory, 0o700)
        tmp = directory / f".token-{secrets.token_hex(8)}.tmp"
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
        fd = os.open(tmp, flags, 0o600)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(token.encode("utf-8"))
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            try:
                tmp.unlink()
            except OSError:
                pass
            raise

    def delete(self) -> None:
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass

    def mode(self) -> int | None:
        """The file's permission bits (for tests and the Connection screen), or None when there is no file."""
        try:
            return stat.S_IMODE(self.path.stat().st_mode)
        except FileNotFoundError:
            return None
