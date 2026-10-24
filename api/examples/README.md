# Sonolith API examples

Complete clients that do the whole flow from [SPEC.md](../SPEC.md): connect → register → wait for approval → store
the token → subscribe to events → handle revoke → unregister. Turn the API on first: Sonolith → Settings → Connected
apps → **Allow other apps to connect**.

| Example | Needs | Run |
|---|---|---|
| [python/sonolith_client.py](python/sonolith_client.py) | Python 3.9+, standard library (uses `keyring` for the token when installed) | `python3 sonolith_client.py register` |
| [node/sonolith-client.ts](node/sonolith-client.ts) | Node.js 22.18+ or 23.6+, no packages | `node sonolith-client.ts register` |
| [shell/](shell/) | `socat` (Linux) or PowerShell (Windows) | read-only one-liners; see its README |

Both clients have the same commands:

- `register`: the user action that asks Sonolith for access (a consent screen appears), stores the token, then runs.
- `run`: connects with the stored token, subscribes to the current track, state and lyric line, and prints events.
  Reconnects with backoff when Sonolith quits or is not running; stops when the user removes the app in Sonolith.
- `status`: prints the player state once.
- `disconnect`: the "Disconnect from Sonolith" action. Unregisters and deletes the token.

They never register on their own: without a token, `run` tells you to run `register`.

App identity (section 6.6 of [SPEC.md](../SPEC.md)): the Python client is `interp:python3:<path of
sonolith_client.py>` (`interp:python:…` on Windows) and the Node client `interp:node:<path of sonolith-client.ts>`.
Updating Python or Node, also through nvm, pyenv, asdf or mise, keeps the identity; moving the script makes Sonolith
ask you again. The shell examples register on their own; see [shell/](shell/).
