# Shell examples

Read-only use from a terminal or a script, with `socat` (Linux) or PowerShell (Windows).

A token is bound to the app identity of the program that registered it (section 6.6 of [SPEC.md](../../SPEC.md)).
A token from the Python or Node example will not work from `socat` or PowerShell: Sonolith would ask the user to
approve the new program. So `socat` and PowerShell each register once on their own, with their own `appId`.

What identity they get:

- `socat` is a native program, so its identity is its executable path, `exe:/usr/bin/socat` (or `exe:/usr/bin/socat1`
  where `socat` is a link to it, as on Arch). Every `socat` command you run is the same app to Sonolith.
- PowerShell is an interpreter. Run interactively (as below), its identity is `interp:pwsh:-` (or
  `interp:powershell:-` for Windows PowerShell 5.1), shared by every interactive PowerShell session. Put the
  commands in a `.ps1` file and run it with `pwsh -File` to get an identity for that script instead.

## Linux (`socat`)

These commands work in bash, zsh and fish (3.4 or newer).

**Register once** (Sonolith shows a consent screen; click Allow). The token is written to a file only you can read:

```sh
mkdir -p ~/.config/sonolith-shell && chmod 700 ~/.config/sonolith-shell
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"app.register","params":{"appId":"com.example.sonolith-shell","name":"Terminal","description":"Shell commands that read what Sonolith is playing.","publisher":"Me","scopes":[{"scope":"player:read","required":true,"reason":"To print the current song in the terminal"}],"apiVersion":"1.0"}}' | socat -t 310 - UNIX-CONNECT:"$XDG_RUNTIME_DIR/sonolith/api.sock" | grep -o 'snl_[A-Za-z0-9_-]*' > ~/.config/sonolith-shell/token
chmod 600 ~/.config/sonolith-shell/token
```

`socat` stays connected until you answer (at most 5 minutes). If the token file ends up empty, the request was
denied or expired.

**Read the player state** (one line):

```sh
printf '{"jsonrpc":"2.0","id":1,"method":"session.hello","params":{"appId":"com.example.sonolith-shell","token":"%s","apiVersion":"1.0"}}\n{"jsonrpc":"2.0","id":2,"method":"player.getState"}\n' "$(cat ~/.config/sonolith-shell/token)" | socat -t 5 - UNIX-CONNECT:"$XDG_RUNTIME_DIR/sonolith/api.sock"
```

`printf` is a shell builtin, so the token does not appear in the process list. With `jq` installed, add
`| jq -r 'select(.id==2) | .result.item.title // "nothing"'` to print just the title.

**Follow the current track** (prints a line per track change until you press Ctrl+C):

```sh
{ printf '{"jsonrpc":"2.0","id":1,"method":"session.hello","params":{"appId":"com.example.sonolith-shell","token":"%s","apiVersion":"1.0"}}\n{"jsonrpc":"2.0","id":2,"method":"events.subscribe","params":{"topics":["player.track"]}}\n' "$(cat ~/.config/sonolith-shell/token)"; cat; } | socat - UNIX-CONNECT:"$XDG_RUNTIME_DIR/sonolith/api.sock"
```

(In fish, replace `{ …; cat; }` with `begin; …; cat; end`.)

**Disconnect** (removes the registration and the token):

```sh
printf '{"jsonrpc":"2.0","id":1,"method":"session.hello","params":{"appId":"com.example.sonolith-shell","token":"%s","apiVersion":"1.0"}}\n{"jsonrpc":"2.0","id":2,"method":"app.unregister"}\n' "$(cat ~/.config/sonolith-shell/token)" | socat -t 5 - UNIX-CONNECT:"$XDG_RUNTIME_DIR/sonolith/api.sock"; rm -f ~/.config/sonolith-shell/token
```

## Windows (PowerShell)

[sonolith.ps1](sonolith.ps1) has small functions for Windows PowerShell 5.1 and PowerShell 7. It takes the pipe name
from `discovery.json`, checks that the pipe belongs to Sonolith, and keeps the token encrypted for your Windows
account (DPAPI).

```powershell
. .\sonolith.ps1
Register-Sonolith          # once: click Allow in Sonolith
Get-SonolithState          # the player state as an object
(Get-SonolithState).item.title
Disconnect-Sonolith        # removes the registration and the token
```

Read-only one-liner after registering:

```powershell
. .\sonolith.ps1; (Invoke-Sonolith @(@{ method = 'player.getState' }))[-1].result.item.title
```
