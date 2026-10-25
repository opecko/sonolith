# Sonolith local API

**API version 1.0.0** · Status: **draft**. No released Sonolith implements it yet; details may change before the
first release that does. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

Sonolith is a desktop YouTube Music client for Linux and Windows. Its local API lets other programs on the same
computer (status bars, widgets, shells, scripts, bots) see and control playback, read and change the queue, browse
the user's library, search YouTube Music, and read lyrics with timings, with live events for all of it.

Every app must **register** first, and the user approves it on a consent screen, much like "Sign in with Google".
The user sees what the app asks for and why, can turn off optional permissions, and can remove the app at any time.

This document is self-contained: it is everything you need to write an integration. The same reference is available
as [openrpc.json](openrpc.json) (machine-readable), [schema/](schema/) (JSON Schemas), [llms.txt](llms.txt) (a compact
summary for AI assistants) and [examples/](examples/) (complete clients).

## Contents

1. [Quick start in 5 minutes](#1-quick-start-in-5-minutes)
2. [Conventions](#2-conventions)
3. [Transport](#3-transport)
4. [Protocol](#4-protocol)
5. [Versioning](#5-versioning)
6. [Registration and consent](#6-registration-and-consent)
7. [Tokens and sessions](#7-tokens-and-sessions)
8. [Scopes](#8-scopes)
9. [Disconnecting and revoking](#9-disconnecting-and-revoking)
10. [Events](#10-events)
11. [Errors](#11-errors)
12. [Limits](#12-limits)
13. [Data model](#13-data-model)
14. [Security model](#14-security-model)
15. [Method reference](#15-method-reference)
16. [Event reference](#16-event-reference)
17. [Data types](#17-data-types)
18. [Integration checklist](#18-integration-checklist)
19. [Glossary](#19-glossary)

---

## 1. Quick start in 5 minutes

This walks through the whole flow by hand on Linux with `socat`. On Windows, run the Python example instead
(`python examples/python/sonolith_client.py`); it does the same steps.

**Step 1: turn the API on.** In Sonolith, open Settings → Connected apps and switch on **Allow other apps to
connect**. The API is off by default; while it is off, the socket does not exist.

**Step 2: connect.**

```sh
socat - UNIX-CONNECT:"$XDG_RUNTIME_DIR/sonolith/api.sock"
```

Every message is one line of JSON. Type or paste a line and press Enter; Sonolith's answers appear as lines too.

**Step 3: register.** Paste this line:

```json
{"jsonrpc":"2.0","id":1,"method":"app.register","params":{"appId":"com.example.quickstart","name":"Quick Start","description":"Trying out the Sonolith API.","publisher":"Me","scopes":[{"scope":"player:read","required":true,"reason":"To print the current song"},{"scope":"player:control","required":false,"reason":"To pause and skip"}],"apiVersion":"1.0"}}
```

Sonolith answers at once that the request is waiting for you:

```json
{"jsonrpc":"2.0","id":1,"result":{"status":"pending","requestId":"req_5Jt2xQ","expiresAt":1793022300000}}
```

**Step 4: approve.** A notification "Quick Start wants to connect to Sonolith" appears and Sonolith shows a consent
screen. Click **Allow**. On the same connection you get a notification with your **token**:

```json
{"jsonrpc":"2.0","method":"registration.resolved","params":{"requestId":"req_5Jt2xQ","kind":"register","status":"approved","token":"snl_8dmJuD9Z2UkFfCj61pn7Zn_0hI0YOf9Cuw_XU3Uerv0","grantedScopes":["player:read","player:control"],"retryAfterMs":null}}
```

The token is sent only this once. A real app stores it in a secret store right away (section 7).

**Step 5: authenticate and use the API.** Send `session.hello` with your token (on this connection or any later
one), then call methods and subscribe to events. Replace the token with yours:

```json
{"jsonrpc":"2.0","id":2,"method":"session.hello","params":{"appId":"com.example.quickstart","token":"snl_8dmJuD9Z2UkFfCj61pn7Zn_0hI0YOf9Cuw_XU3Uerv0","apiVersion":"1.0"}}
{"jsonrpc":"2.0","id":3,"method":"player.getState"}
{"jsonrpc":"2.0","id":4,"method":"player.toggle"}
{"jsonrpc":"2.0","id":5,"method":"events.subscribe","params":{"topics":["player.track","player.state"]}}
```

After `events.subscribe` you get one snapshot event per topic, then an event whenever something changes:

```json
{"jsonrpc":"2.0","method":"player.trackChanged","params":{"item":{"type":"track","id":"Xk3vT9pQm2A","title":"Glass Harbor","artists":[{"id":"UCq7kZ3mX9vYbL2nT5cR8wQA","name":"Northern Static"}],"album":{"id":"MPREb_4pL8gzRtw9a","title":"Low Tide Radio"},"durationMs":214000,"thumbnailUrl":"https://lh3.googleusercontent.com/example-artwork=w544-h544","explicit":false,"video":false,"rating":"like"}}}
```

**Step 6: clean up.** Remove the test app again:

```json
{"jsonrpc":"2.0","id":6,"method":"app.unregister"}
```

That is the whole protocol. A real app adds what this walk-through skips: storing the token securely, reconnecting
with backoff, handling `session.revoked`, and a "Disconnect from Sonolith" button. The
[integration checklist](#18-integration-checklist) lists everything, and [examples/](examples/) has complete clients.

---

## 2. Conventions

- The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY** and
  **OPTIONAL** are to be read as described in RFC 2119 and RFC 8174 when, and only when, they appear in capitals.
- "Client" or "app" means the program that connects to Sonolith. "User" means the person using Sonolith.
- JSON examples are shown pretty-printed when they are long. On the wire, every message is one line.
- Example ids, names and tokens are made up.
- Field names are `camelCase`. Method and event names are `namespace.name`.

---

## 3. Transport

Sonolith listens on a local endpoint that only the current user can open. There is no network listener.

### 3.1 Linux

- The endpoint is a Unix domain stream socket at `$XDG_RUNTIME_DIR/sonolith/api.sock`.
- The directory `$XDG_RUNTIME_DIR/sonolith/` has mode `0700` and the socket has mode `0600`, both owned by the user.
- When `XDG_RUNTIME_DIR` is unset or empty, Sonolith uses `/tmp/sonolith-<uid>/api.sock`, where `<uid>` is the
  user's numeric id. Sonolith creates that directory with mode `0700` and refuses to use it if it exists and is
  owned by another user or is accessible to others.
- Clients using the `/tmp` fallback SHOULD check that the directory is owned by their own uid and has mode `0700`
  before connecting.
- **Flatpak:** a sandboxed app sees the socket only when its manifest (or the user, with `flatpak override --user
  --filesystem=xdg-run/sonolith <app-id>`) grants `--filesystem=xdg-run/sonolith`. Read access is not enough to
  connect; the permission must not be `:ro`. Such an app gets the identity `flatpak:<app-id>` (section 6.6), so it
  stays the same app across Flatpak updates. Other sandboxes (for example Snap with strict confinement) cannot reach
  the socket unless they are given access to that path.

### 3.2 Windows

- The endpoint is the named pipe `\\.\pipe\sonolith-api-<user>`, where `<user>` is the Windows user name in lower
  case with every character other than `a`–`z`, `0`–`9`, `.`, `_` and `-` replaced by `_`.
- The pipe's access control list allows only the current user. Remote clients are rejected.
- If another process already holds that name, Sonolith uses `\\.\pipe\sonolith-api-<user>-<random>` instead and
  writes that name to `discovery.json`.
- Clients on Windows **MUST** take the pipe name from `discovery.json` (section 3.3) rather than build it.
- Clients on Windows SHOULD check that the pipe's server process id (`GetNamedPipeServerProcessId`) equals `pid`
  in `discovery.json` before sending a token. See [Security model](#14-security-model) for why.

### 3.3 Discovery

While the API is on, Sonolith writes `discovery.json` next to the endpoint:

| Platform | Discovery file |
|---|---|
| Linux | `$XDG_RUNTIME_DIR/sonolith/discovery.json` (or `/tmp/sonolith-<uid>/discovery.json`) |
| Windows | `%LOCALAPPDATA%\Sonolith\api\discovery.json` |

```json
{
  "apiVersion": "1.0.0",
  "appVersion": "2.4.0",
  "transport": "unix",
  "path": "/run/user/1000/sonolith/api.sock",
  "pid": 4242,
  "startedAt": 1793021000000
}
```

On Windows, `transport` is `pipe` and `path` is the full pipe name, for example `\\.\pipe\sonolith-api-alex`.
Schema: [schema/discovery.schema.json](schema/discovery.schema.json). Clients MUST ignore unknown fields.

To find Sonolith, a client:

1. reads `discovery.json`; if it exists, connects to `path`;
2. on Linux only, if the file does not exist, MAY connect to the default socket path directly;
3. if neither works, treats Sonolith as **not available** (section 3.4).

### 3.4 Sonolith not available

The endpoint and the discovery file exist only while Sonolith runs **and** the API is on. A client cannot tell
"not running" from "API off", and does not need to.

- A client SHOULD retry with exponential backoff: start at 1 second, double each time, at most 60 seconds, with
  random jitter of ±20%. It SHOULD reset the backoff after a successful `session.hello`.
- A client MAY watch the discovery file's directory instead of polling.
- A client MUST NOT start Sonolith on its own. It MAY offer the user a "Start Sonolith" action, and MUST NOT start
  Sonolith more than once per user action.
- While Sonolith is not available, a client SHOULD tell the user something like "Sonolith is not running, or
  'Allow other apps to connect' is off in its Settings → Connected apps."

### 3.5 Lifecycle

- Sonolith creates the endpoint and the discovery file when the API is turned on (or at startup when it is on), and
  removes both when the API is turned off or Sonolith quits. Turning the API off closes every connection at once
  (unsent messages are dropped) and nothing a client sends afterwards is executed; tokens stay valid.
- After a crash, a stale socket file or discovery file can remain. Sonolith removes them at its next start. A
  client that gets "connection refused" on an existing socket file MUST treat Sonolith as not available and MUST NOT
  delete the file.
- The API keeps working while Sonolith's window is hidden (for example, in the system tray).

### 3.6 Multiple clients

- Any number of apps can be connected at once, within the [limits](#12-limits).
- One app MAY open several connections. Each connection authenticates on its own with `session.hello` and has its
  own subscriptions. Rate limits are shared by all connections of an app.

---

## 4. Protocol

### 4.1 JSON-RPC 2.0

Messages follow [JSON-RPC 2.0](https://www.jsonrpc.org/specification), with these rules:

- Params are always **by name** (a JSON object). Positional params (an array) fail with `InvalidParams`. A method
  without required params accepts a missing `params` member or `{}`.
- Request `id` MUST be a string or an integer. Sonolith never sends requests to the client, only responses and
  notifications.
- Sonolith rejects unknown params with `InvalidParams` (reason `unknownParam`), so a client learns when it uses a
  feature this Sonolith does not have.
- Batches (JSON arrays) are not supported and fail with `InvalidRequest` (reason `batchNotSupported`).
- A request without `id` (a client notification) is accepted and executed, but never answered. Clients SHOULD
  always send an `id`.

### 4.2 Framing

- Each message is one UTF-8 encoded JSON value followed by a line feed (`\n`, byte `0x0A`). A carriage return before
  the line feed is ignored. JSON text never contains a raw line feed (line feeds inside strings are escaped as
  `\n`), so this is unambiguous.
- A message MUST NOT exceed **1 MiB** (1 048 576 bytes, without the line feed). Sonolith answers an oversized message
  with `InvalidRequest` (reason `messageTooLarge`, `id` null) and closes the connection. Sonolith's own messages
  also stay within 1 MiB: an answer that would be larger comes as `InternalError` (reason `resultTooLarge`), and an
  event that would be larger is not sent.
- A line that is not valid UTF-8 or not valid JSON gets a `ParseError` with `id` null; the connection stays open.
- Empty lines are ignored.

### 4.3 Order and concurrency

- Sonolith MAY process requests of one connection concurrently and MAY answer them in any order. Match responses
  by `id`.
- `session.hello` and `app.register` are the exception: Sonolith finishes them before it reads the next message, so
  a client MAY send requests right after `session.hello` without waiting for its response.
- Notifications (events) of one connection arrive in the order they happened. They can arrive between responses.
- A connection allows at most 16 requests in flight. More fail with `RateLimited` (reason `tooManyInFlight`).
- **Half-close:** a client MAY shut down its sending side after its last request (for example, a shell pipe that
  ends). That does not close the connection: Sonolith still answers every request, still delivers
  `registration.resolved` for a pending registration, and then closes the connection once it has nothing more to
  send. Subscriptions end at the half-close.

### 4.4 Connection states

| State | Allowed methods |
|---|---|
| New connection | `app.info`, `app.register`, `session.hello` |
| Registration pending | the same; the outcome arrives as `registration.resolved` |
| Authenticated (after `session.hello` succeeds) | every method except `app.register` and `session.hello` |

Calling another method before `session.hello` fails with `SessionRequired`. Calling `session.hello` or
`app.register` on an authenticated connection fails with `InvalidRequest` (reason `alreadyAuthenticated`).

---

## 5. Versioning

### 5.1 API version

- The API has its own semantic version (`MAJOR.MINOR.PATCH`), separate from Sonolith's app version. This document
  describes **1.0.0**.
- A client sends the version it was written for, as `MAJOR.MINOR` (for example `"1.0"`), in `apiVersion` of
  `app.register` and `session.hello`.
- Sonolith accepts the request when it supports that major version, whatever the minor. If not, the call fails with
  `UnsupportedVersion` and `data.supported` lists the majors it supports.
- `app.info` (no session needed), `session.hello` and `discovery.json` report Sonolith's full API version. A client
  MUST NOT call methods or subscribe to topics newer than that version; `app.info` lists exactly what is supported.

### 5.2 Compatibility promise

Within a major version, Sonolith only makes **compatible** changes:

- new methods, events, topics, scopes, error reasons and optional params;
- new fields in results and event params;
- new values in enums documented as open ("treat unknown values as …");
- relaxed limits.

Therefore clients **MUST** ignore unknown fields, MUST ignore notifications with unknown method names, and MUST handle
unknown values in open enums as documented. Anything else, such as removing or renaming a method or field, changing
a type, making an optional param required, or adding a value to a closed enum, needs a new major version.

### 5.3 Deprecation

- A deprecated method, event, field or param keeps working for the rest of its major version. It is marked
  `deprecated` in [openrpc.json](openrpc.json) and in this document, and listed in [CHANGELOG.md](CHANGELOG.md) with
  its replacement.
- A new major version is announced in CHANGELOG.md at least 3 months before a Sonolith release drops the old one.

---

## 6. Registration and consent

An app gets access by registering once. The user approves it, and the app receives a token for every later
connection.

### 6.1 The flow

```text
App                              Sonolith                              User
 |-- app.register --------------->|                                      |
 |                                |-- derives the app identity           |
 |<-------------- pending --------|-- notification + consent screen ---->|
 |   (keeps the connection open)  |                                      |
 |                                |<---------- Allow / Deny / Block -----|
 |<--- registration.resolved -----|                                      |
 |   (approved: token, scopes)    |                                      |
 |-- stores the token securely    |                                      |
 |-- session.hello -------------->|                                      |
 |<-------------- session --------|                                      |
```

1. The app calls [`app.register`](#appregister) with its `appId`, display details and the scopes it wants, each
   with a `reason`. It works without a token.
2. Sonolith identifies the calling process through the operating system (Linux: the socket's peer credentials;
   Windows: the pipe client's process id) and derives its **app identity** (section 6.6). If it cannot, or not
   within 2 seconds, the call fails with `Unavailable` (reason `peerUnverified`). The `pending` result includes the identity, so a developer
   can see what the user is shown.
3. Sonolith answers `pending` at once, shows a system notification "<name> wants to connect to Sonolith" and a
   consent screen. Clicking the notification brings Sonolith to the front, also when it is hidden in the tray.
4. The app waits for [`registration.resolved`](#registrationresolved) on the **same connection**.
5. On approval the notification carries the **token** and the granted scopes. The app stores the token and calls
   [`session.hello`](#sessionhello). The registering connection is not authenticated by the approval itself.

Rules:

- The client **MUST** call `app.register` only after a user action, such as a "Connect to Sonolith" button. It MUST
  NOT register at startup without one, and MUST NOT register again automatically after `Unauthorized`,
  `NotRegistered`, `session.revoked`, a denial or an expiry.
- The client **MUST** keep the connection open while the request is pending. If the connection closes, Sonolith
  cancels the request and withdraws the consent screen.
- A pending request **expires after 5 minutes**. The client then gets `registration.resolved` with status `expired`.
- One `appId` can have one pending request at a time. A second `app.register` for it, from another connection,
  fails with `RegistrationPending`.
- At most 3 registration requests (from all apps) wait at a time. More fail with `RateLimited` (reason
  `tooManyPending`).

### 6.2 What the user sees

The consent screen shows:

- the app's icon, name, publisher and homepage, as the app declared them;
- the **app identity** (section 6.6): the executable path, for example `/usr/bin/mybar` or
  `C:\Program Files\MyBar\mybar.exe`; for a script, the interpreter and the script path; for an AppImage, the
  AppImage file; for a Flatpak, the Flatpak app id;
- "<name> wants to:", followed by one line per scope: the scope's label from the [scope table](#8-scopes) and the
  app's `reason` under it;
- a checkbox per optional scope (ticked by default) that the user can untick; required scopes have no checkbox;
- sensitive scopes (`library:write`) marked with a warning;
- the buttons **Allow**, **Deny**, and **Deny and block this app**. They respond only after the screen has been shown
  for a second (also when the next waiting request takes its place), and none of them is a default for Enter.

If the `appId` is already registered, the screen says so (and shows both programs when another program asks), and
approving replaces the old token (its connections get `session.revoked` with reason `replaced`).

Write `name`, `description` and every `reason` for this screen: plain language, no jargon, in English. Good
reasons say what the user gets: "To show the current song in your bar", not "Needs player:read".

### 6.3 Outcomes

`registration.resolved` has a `status`:

| Status | Meaning | What the client does |
|---|---|---|
| `approved` | The user allowed it. `token` (for `kind` `register`) and `grantedScopes` are set. | Store the token, then `session.hello`. Use only `grantedScopes`. |
| `denied` | The user said no. `retryAfterMs` says when asking again is possible. | Tell the user. Do not ask again before `retryAfterMs`, and then only after a user action. |
| `blocked` | The user said no and blocked the app. | Tell the user; the app can be unblocked in Sonolith's Settings → Connected apps. Stop asking. |
| `expired` | Nobody answered within 5 minutes. `retryAfterMs` is set. | Tell the user; offer to try again. |

### 6.4 Spam protection

- After a denial, new requests from the same `appId` **or** the same app identity are refused for a
  **cooldown** with `RegistrationDenied` and `data.retryAfterMs`, without bothering the user: 1 minute after the
  first denial, 10 minutes after the second, 1 hour after each further one. The count starts again after an
  approval, or when 24 hours pass without a denial. Show the wait to the user ("You can ask again in 40 s") from
  `retryAfterMs`; never hardcode it.
- After an expiry, the cooldown is 1 minute.
- The user can lift a cooldown at once in Settings → Connected apps (**Allow it to ask again**). The app is not
  told; its next request after a user action simply goes through.
- A blocked app gets `Blocked` for `app.register` and `session.hello`, and nothing is shown to the user, until the
  user unblocks it in Settings → Connected apps. **Deny and block this app** on a consent screen blocks the program
  that asked (its app identity), under any `appId`; another program already registered under the same `appId` keeps
  working. Blocking a connected app in Settings blocks its `appId` and its app identity. Either way, registrations
  of the blocked program end and its open sessions get `session.revoked` with reason `blocked`.
- `app.requestScopes` follows the same cooldowns.

### 6.5 Asking for more scopes later

An authenticated app can ask for scopes it was not granted with [`app.requestScopes`](#apprequestscopes). The user
sees a consent screen with only the new scopes (Allow, Deny). The outcome arrives as `registration.resolved` with
`kind` `scopes`, and an approval is followed by `session.scopesChanged`. The same rules apply: only after a user
action, keep the connection open, cooldown after a denial.

### 6.6 App identity

A token is bound to the `appId` **and** the **app identity** the user approved. The app identity says which program
is calling. Sonolith derives it from what the operating system reports about the calling process: its executable
path, its command line, its working directory, its environment and, on Linux, whether it runs in a Flatpak sandbox.
It is built so that ordinary updates (a new Python, a new Node version through a version manager, an updated
AppImage, a new install folder of a self-updating app) keep the same identity.

Sonolith checks these rules in order and uses the first that applies:

1. **Flatpak** (Linux): the process runs in a Flatpak sandbox. The identity is the Flatpak app id. Key:
   `flatpak:<app-id>`.
2. **AppImage** (Linux): the executable lies inside an AppImage mount (a directory whose name starts with
   `.mount_`) and the process environment has `APPIMAGE` set to an existing file. The identity is that file, not the
   random mount path. Version numbers in the file name (`MyBar-1.4.2-x86_64.AppImage`) are replaced by `*`. Key:
   `appimage:<path>`.
3. **Interpreter**: the executable's file name, without `.exe`, is one of `python`, `pythonw`, `node`, `nodejs`,
   `bun`, `deno`, `ruby`, `perl`, `sh`, `dash`, `bash`, `zsh`, `fish`, `pwsh`, `powershell`, optionally followed by
   a version (`python3.13`, `ruby3.2`). The identity is the **interpreter family** plus the **script**:
   - The family is the name with only the major version kept (`python3.13` → `python3`, `ruby3.2` → `ruby3`;
     `pythonw` → `python`, `nodejs` → `node`). The interpreter's own path is not part of the identity, so updating
     or moving the interpreter changes nothing.
   - The script is the first command-line argument that is not an interpreter option (Sonolith skips options and
     their values, `bun run` and `deno run`, and takes the argument after `--`), made absolute against the
     process's working directory, with symbolic links resolved. It must be an existing file; otherwise there is no
     script. `python -m <module>` gives the script `module:<module>`. Inline code (`-c`, `-e`, `--eval`,
     `-Command`) and interactive sessions give no script. Windows PowerShell 5.1 (`powershell`) treats a bare
     argument as a command, so only `-File <path>` names a script there; PowerShell 7 (`pwsh`) also accepts a bare
     path.
   - Key: `interp:<family>:<script>`, or `interp:<family>:-` without a script.
4. **Executable**: anything else. The identity is the executable path. Key: `exe:<path>`.

In script and executable paths, Sonolith replaces version segments with `*`:

| Where | Example | Becomes |
|---|---|---|
| nvm | `~/.nvm/versions/node/v20.11.0/…` | `~/.nvm/versions/node/*/…` |
| nvm-windows | `…\nvm\v20.11.0\…` | `…\nvm\*\…` |
| pyenv | `~/.pyenv/versions/3.12.4/…` | `~/.pyenv/versions/*/…` |
| asdf | `~/.asdf/installs/<tool>/1.22.1/…` | `~/.asdf/installs/<tool>/*/…` |
| mise | `…/mise/installs/<tool>/22.3.0/…` | `…/mise/installs/<tool>/*/…` |
| Volta | `~/.volta/tools/image/<tool>/20.11.0/…` | `~/.volta/tools/image/<tool>/*/…` |
| fnm | `…/fnm/node-versions/v20.11.0/…` | `…/fnm/node-versions/*/…` |
| Homebrew on Linux | `…/Cellar/<formula>/1.2.3/…` | `…/Cellar/<formula>/*/…` |
| Python library folder | `…/lib/python3.13/…` | `…/lib/python3.*/…` |
| Windows Python | `…\Python313\…`, `…\Python313-32\…` | `…\Python3*\…`, `…\Python3*-32\…` |
| Snap | `/snap/<name>/123/…` | `/snap/<name>/*/…` |
| Self-updating Windows apps | `…\app-1.2.3\…` | `…\app-*\…` |
| Microsoft Store (MSIX) | `…\WindowsApps\<Name>_1.2.3.0_x64__<id>\…` | `…\WindowsApps\<Name>_*_x64__<id>\…` |

On Windows, keys are compared in lower case, because Windows paths ignore case. The consent screen and `identity`
in results show the real paths. Every case below is part of Sonolith's tests
([tests/identity-cases.json](tests/identity-cases.json)); cases with the same key are the same app.

<!-- BEGIN GENERATED: identity -->
| Case | Process | Identity key |
|---|---|---|
| Native executable | exe `/usr/bin/mybar`, argv `mybar --daemon`, cwd `/home/alex` | `exe:/usr/bin/mybar` |
| Python script, relative path, interpreter options | exe `/usr/bin/python3.13`, argv `python3 -u -W ignore bin/bar.py --verbose`, cwd `/home/alex` | `interp:python3:/home/alex/bin/bar.py` |
| The same Python script after a Python update (same key) | exe `/usr/bin/python3.14`, argv `/usr/bin/python3 /home/alex/bin/bar.py`, cwd `/` | `interp:python3:/home/alex/bin/bar.py` |
| Python module (-m) | exe `/usr/bin/python3.13`, argv `python3 -m mybar run`, cwd `/home/alex` | `interp:python3:module:mybar` |
| Python with inline code (-c): no script | exe `/usr/bin/python3.13`, argv `python3 -c import mybar; mybar.main()`, cwd `/home/alex` | `interp:python3:-` |
| Python package under a versioned site-packages directory | exe `/usr/bin/python3.13`, argv `python3 /home/alex/.local/lib/python3.13/site-packages/mybar/__main__.py`, cwd `/home/alex` | `interp:python3:/home/alex/.local/lib/python3.*/site-packages/mybar/__main__.py` |
| pyenv: console script inside a versioned Python | exe `/home/alex/.pyenv/versions/3.12.4/bin/python3.12`, argv `/home/alex/.pyenv/versions/3.12.4/bin/python3.12 /home/alex/.pyenv/versions/3.12.4/bin/mybar`, cwd `/home/alex` | `interp:python3:/home/alex/.pyenv/versions/*/bin/mybar` |
| nvm: globally installed npm package | exe `/home/alex/.nvm/versions/node/v20.11.0/bin/node`, argv `node /home/alex/.nvm/versions/node/v20.11.0/lib/node_modules/mybar/bin/cli.js`, cwd `/home/alex` | `interp:node:/home/alex/.nvm/versions/node/*/lib/node_modules/mybar/bin/cli.js` |
| nvm: the same package after switching to Node 22 (same key) | exe `/home/alex/.nvm/versions/node/v22.3.0/bin/node`, argv `node /home/alex/.nvm/versions/node/v22.3.0/lib/node_modules/mybar/bin/cli.js`, cwd `/home/alex` | `interp:node:/home/alex/.nvm/versions/node/*/lib/node_modules/mybar/bin/cli.js` |
| Node with --require and a relative script | exe `/usr/bin/node`, argv `node --require ./tracing.js --enable-source-maps dist/index.js`, cwd `/home/alex/proj` | `interp:node:/home/alex/proj/dist/index.js` |
| mise: Node installed per version | exe `/home/alex/.local/share/mise/installs/node/22.3.0/bin/node`, argv `node /home/alex/.local/share/mise/installs/node/22.3.0/lib/node_modules/mybar/cli.js`, cwd `/home/alex` | `interp:node:/home/alex/.local/share/mise/installs/node/*/lib/node_modules/mybar/cli.js` |
| Bun: bun run | exe `/home/alex/.bun/bin/bun`, argv `bun run src/bar.ts`, cwd `/home/alex/proj` | `interp:bun:/home/alex/proj/src/bar.ts` |
| Bun: a subcommand that is not a file gives no script | exe `/home/alex/.bun/bin/bun`, argv `bun x mybar`, cwd `/home/alex` | `interp:bun:-` |
| Deno: deno run with permission flags | exe `/usr/bin/deno`, argv `deno run --allow-net --config deno.json main.ts`, cwd `/home/alex/proj` | `interp:deno:/home/alex/proj/main.ts` |
| Ruby with a versioned binary name | exe `/usr/bin/ruby3.2`, argv `ruby -I lib bar.rb`, cwd `/home/alex/proj` | `interp:ruby3:/home/alex/proj/bar.rb` |
| Perl | exe `/usr/bin/perl`, argv `perl -w /home/alex/bin/bar.pl`, cwd `/home/alex` | `interp:perl:/home/alex/bin/bar.pl` |
| Bash script run through its shebang | exe `/usr/bin/bash`, argv `/bin/bash ./now-playing.sh`, cwd `/home/alex/bin` | `interp:bash:/home/alex/bin/now-playing.sh` |
| fish with -c: no script | exe `/usr/bin/fish`, argv `fish -c mybar --once`, cwd `/home/alex` | `interp:fish:-` |
| Script after -- | exe `/usr/bin/zsh`, argv `zsh -- -weird-name.zsh`, cwd `/home/alex` | `interp:zsh:/home/alex/-weird-name.zsh` |
| AppImage | exe `/tmp/.mount_MyBarAb12Cd/usr/bin/mybar`, argv `/tmp/.mount_MyBarAb12Cd/usr/bin/mybar`, cwd `/home/alex`, `APPIMAGE=/home/alex/Apps/MyBar-1.4.2-x86_64.AppImage` | `appimage:/home/alex/Apps/MyBar-*-x86_64.AppImage` |
| The same AppImage after an update, mounted elsewhere (same key) | exe `/tmp/.mount_MyBarZz98Yx/usr/bin/mybar`, argv `/tmp/.mount_MyBarZz98Yx/usr/bin/mybar`, cwd `/home/alex`, `APPIMAGE=/home/alex/Apps/MyBar-1.5.0-x86_64.AppImage` | `appimage:/home/alex/Apps/MyBar-*-x86_64.AppImage` |
| AppImage that bundles an interpreter | exe `/tmp/.mount_ToolQq11/usr/bin/python3.11`, argv `python3.11 /tmp/.mount_ToolQq11/usr/share/tool/main.py`, cwd `/home/alex`, `APPIMAGE=/home/alex/Apps/Tool.AppImage` | `appimage:/home/alex/Apps/Tool.AppImage` |
| APPIMAGE set but the process is not running from an AppImage mount (ignored) | exe `/usr/bin/mybar`, argv `mybar`, cwd `/home/alex`, `APPIMAGE=/home/alex/Apps/Other.AppImage` | `exe:/usr/bin/mybar` |
| asdf: a native tool installed per version | exe `/home/alex/.asdf/installs/golang/1.22.1/packages/bin/mybar`, argv `mybar`, cwd `/home/alex` | `exe:/home/alex/.asdf/installs/golang/*/packages/bin/mybar` |
| Snap: the revision directory | exe `/snap/mybar/123/usr/bin/mybar`, argv `mybar`, cwd `/home/alex` | `exe:/snap/mybar/*/usr/bin/mybar` |
| Flatpak | exe `/app/bin/mybar`, argv `mybar`, cwd `/home/alex`, Flatpak `com.example.MyBar` | `flatpak:com.example.MyBar` |
| Windows: native executable (keys ignore case) | exe `C:\Program Files\MyBar\MyBar.exe`, argv `MyBar.exe`, cwd `C:\Users\Alex` | `exe:c:\program files\mybar\mybar.exe` |
| Windows: Python script | exe `C:\Users\Alex\AppData\Local\Programs\Python\Python313\python.exe`, argv `python bar.py`, cwd `C:\Users\Alex\Scripts` | `interp:python:c:\users\alex\scripts\bar.py` |
| Windows: Python package in a versioned PythonXY directory, run by pythonw | exe `C:\Users\Alex\AppData\Local\Programs\Python\Python312\pythonw.exe`, argv `pythonw.exe C:\Users\Alex\AppData\Local\Programs\Python\Python312\Lib\site-packages\mybar\__main__.py`, cwd `C:\Users\Alex` | `interp:python:c:\users\alex\appdata\local\programs\python\python3*\lib\site-packages\mybar\__main__.py` |
| Windows: PowerShell 7 with -File | exe `C:\Program Files\PowerShell\7\pwsh.exe`, argv `pwsh.exe -NoProfile -ExecutionPolicy Bypass -File .\bar.ps1`, cwd `C:\Users\Alex\Scripts` | `interp:pwsh:c:\users\alex\scripts\bar.ps1` |
| Windows: interactive Windows PowerShell 5.1 (a positional argument is a command, not a file) | exe `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, argv `powershell.exe -NoLogo bar.ps1`, cwd `C:\Users\Alex\Scripts` | `interp:powershell:-` |
| Windows: nvm-windows Node with a global package | exe `C:\Users\Alex\AppData\Roaming\nvm\v20.11.0\node.exe`, argv `node C:\Users\Alex\AppData\Roaming\nvm\v20.11.0\node_modules\mybar\cli.js`, cwd `C:\Users\Alex` | `interp:node:c:\users\alex\appdata\roaming\nvm\*\node_modules\mybar\cli.js` |
| Windows: self-updating app with app-<version> folders | exe `C:\Users\Alex\AppData\Local\MyBar\app-1.2.3\MyBar.exe`, argv `MyBar.exe`, cwd `C:\Users\Alex` | `exe:c:\users\alex\appdata\local\mybar\app-*\mybar.exe` |
| Windows: Microsoft Store (MSIX) app | exe `C:\Program Files\WindowsApps\Example.MyBar_1.2.3.0_x64__8wekyb3d8bbwe\MyBar.exe`, argv `MyBar.exe`, cwd `C:\Users\Alex` | `exe:c:\program files\windowsapps\example.mybar_*_x64__8wekyb3d8bbwe\mybar.exe` |
<!-- END GENERATED: identity -->

When `session.hello` comes from a process with a **different** identity key (the app moved, its script moved, or a
different program uses the token):

1. `session.hello` fails with `RegistrationPending` (reason `identityChanged`, with `data.requestId` and
   `data.expiresAt`).
2. The user sees "<name> was updated or moved" with the old and the new identity, and Allow, Deny, Deny and block.
3. The client keeps the connection open and waits for `registration.resolved` with `kind` `identity`.
4. On `approved`, the token stays the same and is now bound to the new identity; the client calls `session.hello`
   again. On `denied` or `expired`, the token still works from the old identity only.

Advice for developers:

- Keep the program or script at a stable path. Moving it asks the user again.
- A script's identity is its interpreter family and its path. Start it the same way every time; prefer a script
  file over inline code (`-c`), because every inline-code or interactive session of an interpreter shares one
  identity.
- `session.hello` and `app.info` return the identity Sonolith sees, which helps when testing.

---

## 7. Tokens and sessions

### 7.1 The client token

- On approval Sonolith issues a **client token**: `snl_` followed by 43 base64url characters (256 random bits).
- Sonolith sends it **once**, in `registration.resolved`. Sonolith keeps only a hash of it and cannot show it again.
  A lost token means registering again.
- The token belongs to one app on one computer for one user. Tokens do not expire on their own; they end when the
  app unregisters, the user removes or blocks the app, or the app registers again.

### 7.2 Storing the token

The client **MUST** store the token so that other users cannot read it:

- It SHOULD use the platform's secret store: on Linux, the Secret Service (for example via libsecret, `secret-tool`
  or Python `keyring`); on Windows, the Credential Manager or DPAPI with user scope.
- If no secret store is available, it MAY use a file readable only by the user (mode `0600` on Linux; on Windows, a
  file in the user's profile, which is private to the user by default).
- It MUST NOT log the token, show it in its UI, put it in command lines, URLs or environment variables, commit it to
  version control, or send it anywhere except `session.hello`.
- It MUST delete the token after `app.unregister`, `session.revoked`, `Unauthorized` and `NotRegistered`.

### 7.3 Starting a session

On every new connection the client sends [`session.hello`](#sessionhello) with `appId`, `token` and `apiVersion`
before anything else (except `app.info`). The result has the granted scopes and whether the user is signed in to
YouTube.

| `session.hello` fails with | Meaning | What the client does |
|---|---|---|
| `Unauthorized` | The token is wrong or revoked. | Delete the token. Show "Disconnected from Sonolith". Offer "Connect to Sonolith"; register only when the user clicks it. |
| `NotRegistered` | The app is not registered (anymore). | The same as `Unauthorized`. |
| `Blocked` | The user blocked the app. | Delete the token. Tell the user it can be unblocked in Sonolith's Settings → Connected apps. |
| `RegistrationPending` (`identityChanged`) | The app identity changed; the user is being asked. | Keep the connection open; wait for `registration.resolved` (section 6.6). |
| `UnsupportedVersion` | Sonolith does not speak this API major version. | Tell the user to update Sonolith or the app. |

A session lasts as long as its connection.

---

## 8. Scopes

A scope is a permission. An app asks for the scopes it needs at registration; the user can untick optional ones.
Every method and event topic needs one scope (`playlist.get` accepts either of two). The labels below are exactly
what the user sees on the consent screen and in Settings.

<!-- BEGIN GENERATED: scopes -->
| Scope | The user sees | Sensitive | Allows | Methods | Topics |
|---|---|---|---|---|---|
| `player:read` | See what's playing | no | The current item, playback state, position, volume, shuffle and repeat. | `player.getState` | `player.state`, `player.track`, `player.position`, `player.volume` |
| `player:control` | Control playback | no | Play, pause, skip, seek, volume, shuffle, repeat, episode speed, and starting a track, album, playlist or episode (which replaces the queue). | `player.play`, `player.pause`, `player.toggle`, `player.next`, `player.previous`, `player.seek`, `player.setVolume`, `player.setShuffle`, `player.setRepeat`, `player.setRate`, `player.playItem` | — |
| `queue:read` | See your queue | no | The queue and autoplay. | `queue.get` | `queue` |
| `queue:write` | Change your queue | no | Add, move and remove queue entries, clear the queue, turn autoplay on or off. | `queue.add`, `queue.playNext`, `queue.move`, `queue.remove`, `queue.clear`, `queue.setAutoplay` | — |
| `library:read` | Access your library | no | Playlists, liked songs, albums, artists, podcasts, episodes for later, history, and your ratings in returned items. | `library.playlists`, `library.likedSongs`, `library.albums`, `library.artists`, `library.podcasts`, `library.episodesForLater`, `library.history`, `playlist.get` | — |
| `library:write` | Change your library | **yes** | Create, rename and delete playlists, add and remove playlist items, like and dislike, save albums, playlists and podcasts. | `playlist.create`, `playlist.rename`, `playlist.delete`, `playlist.addTracks`, `playlist.removeTracks`, `rating.set` | — |
| `search` | Search YouTube Music | no | Search, suggestions, and album, artist, podcast, episode and public playlist pages. | `playlist.get`, `search.query`, `search.suggestions`, `browse.album`, `browse.artist`, `browse.podcast`, `browse.episode` | — |
| `lyrics:read` | Show lyrics | no | Lyrics with timings for the current or any track, and live line and word events. | `lyrics.get` | `lyrics`, `lyrics.line`, `lyrics.word` |
<!-- END GENERATED: scopes -->

- No scope is needed for `app.*`, `session.hello`, `events.*` themselves, the `account` topic, and the always-delivered
  events (`registration.resolved`, `session.revoked`, `session.scopesChanged`).
- Calling a method without its scope fails with `PermissionDenied`, and `data.scope` names the scope.
- The client **MUST** use only the scopes it was granted (`grantedScopes` in `session.hello`, updated by
  `session.scopesChanged`), and SHOULD hide or disable features that need other scopes instead of calling and
  failing.
- The user can revoke single scopes later in Settings → Connected apps. The client then gets `session.scopesChanged`.
- Ask only for what the app uses. Mark a scope `required` only if the app cannot work at all without it.
- Without `library:read`, personal fields in returned items are null: `Track.rating`, `Episode.played`,
  `Episode.resumePositionMs`.

---

## 9. Disconnecting and revoking

### 9.1 The app disconnects itself

The client **MUST** offer a visible **"Disconnect from Sonolith"** action (for example, in its settings). It:

1. calls [`app.unregister`](#appunregister) (connecting and sending `session.hello` first if needed);
2. deletes the stored token, also when the call fails because Sonolith is not available;
3. shows the app as disconnected.

Sonolith invalidates the token, removes the app from its list, closes the connection, and shows the user a short
message "<name> disconnected from Sonolith". The app's other connections get `session.revoked` (reason
`unregistered`).

If Sonolith is not available when the user disconnects, the app deletes the token anyway. The registration then
stays in Sonolith's list until the user removes it there.

### 9.2 The user removes the app

The user can remove or block an app in Settings → Connected apps. Sonolith sends
[`session.revoked`](#sessionrevoked) to every connection of the app and closes them. The client **MUST** then:

1. stop using Sonolith;
2. delete the stored token;
3. show "Disconnected from Sonolith";
4. not register again until the user asks for it.

A client that was not connected at the time learns about it from `Unauthorized`, `NotRegistered` or `Blocked` at its
next `session.hello`, and handles it the same way.

---

## 10. Events

Events are JSON-RPC notifications from Sonolith (no `id`, no response). Most come from **topics** the client
subscribes to; three are always delivered.

### 10.1 Topics

<!-- BEGIN GENERATED: topics -->
| Topic | Event | Scope |
|---|---|---|
| `player.state` | [`player.stateChanged`](#playerstatechanged) | `player:read` |
| `player.track` | [`player.trackChanged`](#playertrackchanged) | `player:read` |
| `player.position` | [`player.position`](#playerposition) | `player:read` |
| `player.volume` | [`player.volumeChanged`](#playervolumechanged) | `player:read` |
| `queue` | [`queue.changed`](#queuechanged) | `queue:read` |
| `lyrics` | [`lyrics.changed`](#lyricschanged) | `lyrics:read` |
| `lyrics.line` | [`lyrics.line`](#lyricsline) | `lyrics:read` |
| `lyrics.word` | [`lyrics.word`](#lyricsword) | `lyrics:read` |
| `account` | [`account.changed`](#accountchanged) | none |
<!-- END GENERATED: topics -->

Always delivered, without subscribing: [`registration.resolved`](#registrationresolved),
[`session.revoked`](#sessionrevoked), [`session.scopesChanged`](#sessionscopeschanged).

### 10.2 Subscribing

- [`events.subscribe`](#eventssubscribe) adds topics; [`events.unsubscribe`](#eventsunsubscribe) removes them.
  Subscriptions belong to the connection and end when it closes.
- **Snapshot:** right after the `events.subscribe` response, Sonolith sends one event per newly added topic with the
  current state, so the client never has to combine a separate "get" with the event stream. The snapshots for
  `player.trackChanged`, `player.stateChanged`, `player.volumeChanged`, `queue.changed`, `lyrics.changed` and
  `account.changed` carry the current state. `player.position` sends a snapshot only while an item is loaded,
  `lyrics.line` only while synced lyrics are playing, and `lyrics.word` none.
  `queue.changed` snapshots have reason `other`.
- `positionHz` (1–4, default 1) sets how many `player.position` events per second the connection gets while playing.
- When a scope is removed, subscriptions that need it end without further notice.

### 10.3 Delivery

- Events are not replayed: what happens while a client is disconnected is lost. After reconnecting, subscribe again;
  the snapshots bring the client up to date.
- Sonolith coalesces bursts (for example, dragging the volume slider) and sends the latest state; the last change
  always arrives.
- If a client reads too slowly, Sonolith drops `player.position` and `lyrics.word` events for it rather than
  queueing them. If more than 4 MiB of other messages wait for the client, or the client takes in nothing of a
  message for 10 seconds, Sonolith closes the connection at once, without sending what is still waiting.

---

## 11. Errors

Every error is a JSON-RPC error object. `data` always has `name` and `reason`; some errors add more members.

```json
{"jsonrpc":"2.0","id":7,"error":{"code":-32003,"message":"PermissionDenied","data":{"name":"PermissionDenied","reason":null,"scope":"library:read"}}}
```

- Clients SHOULD match on `code` or `data.name`, never on `message`.
- `data.reason` refines some errors; the list can grow, so treat unknown reasons like `null`.

### 11.1 Error codes

<!-- BEGIN GENERATED: errors -->
| Code | Name | Meaning | What the client does |
|---|---|---|---|
| -32700 | `ParseError` | The line is not valid UTF-8 JSON. | Fix the client. The connection stays open. |
| -32600 | `InvalidRequest` | Not a valid JSON-RPC 2.0 request object, a batch, a message over the size limit (Sonolith then closes the connection), or a call not allowed in the connection's state. | Fix the client. See `data.reason`. |
| -32601 | `MethodNotFound` | No such method in this Sonolith. | Check `app.info` `methods`; the method may be newer than this Sonolith. |
| -32602 | `InvalidParams` | Missing, unknown or invalid parameters, or an expired cursor. | Fix the call. `data.path` points at the parameter; `data.reason` is `cursorExpired` when a cursor is too old. |
| -32603 | `InternalError` | Sonolith failed unexpectedly. | Retry later; report it if it repeats. |
| -32001 | `NotRegistered` | The `appId` is not registered (never registered, unregistered, or removed by the user). | Delete the stored token. Show "Disconnected from Sonolith". Register again only after a user action. |
| -32002 | `Unauthorized` | The token is wrong or has been revoked. | Delete the stored token. Show "Disconnected from Sonolith". Register again only after a user action. |
| -32003 | `PermissionDenied` | The app lacks the scope in `data.scope`. | Do not retry. Hide the feature, or ask for the scope with `app.requestScopes` after a user action. |
| -32004 | `RegistrationPending` | A request is already waiting for the user, or the app identity changed and the user must approve it again. | Wait for `registration.resolved` with `data.requestId` on the connection that made the request. |
| -32005 | `RegistrationDenied` | The user denied a recent request; asking again is on hold. | Do not ask again before `data.retryAfterMs`, and then only after a user action. |
| -32006 | `Blocked` | The user blocked this app. | Stop. Tell the user the app can be unblocked in Sonolith's Settings → Connected apps. |
| -32007 | `NotSignedIn` | The method needs a YouTube account and the user is signed out. | Tell the user to sign in in Sonolith; subscribe to `account` to know when they do. |
| -32008 | `NotFound` | The item does not exist or is not visible to this app. | Do not retry with the same id. |
| -32009 | `RateLimited` | The app exceeded its rate limit or its in-flight request limit. | Wait `data.retryAfterMs`, then retry. |
| -32010 | `Unavailable` | The action is not possible right now (for example, nothing is playing, or Sonolith is still starting). | See `data.reason`; retry after `data.retryAfterMs` when present. |
| -32011 | `Timeout` | YouTube, a lyrics source or Sonolith did not answer in time. | Retry later with backoff. |
| -32012 | `SessionRequired` | The method needs an authenticated session. | Call `session.hello` first. |
| -32013 | `UnsupportedVersion` | Sonolith does not support the requested API major version. | Tell the user to update Sonolith or the app. `data.supported` lists the supported majors. |
<!-- END GENERATED: errors -->

### 11.2 Common errors

Any method can fail with `InvalidRequest`, `InvalidParams`, `InternalError`, `RateLimited`, `Unavailable` (for
example, reason `starting`) and `Timeout`. Methods that need a session can also fail with `SessionRequired`, and
methods that need a scope with `PermissionDenied`. The method reference lists the other errors of each method.

### 11.3 Error reasons

<!-- BEGIN GENERATED: reasons -->
| Reason | Error | Meaning |
|---|---|---|
| `messageTooLarge` | `InvalidRequest` | The message was over 1 MiB. Sonolith closes the connection. |
| `batchNotSupported` | `InvalidRequest` | The message was a JSON array (a batch). |
| `resultTooLarge` | `InternalError` | The answer would be over 1 MiB, Sonolith's own message limit. Ask for less, for example a smaller `limit`. |
| `alreadyAuthenticated` | `InvalidRequest` | `session.hello` or `app.register` on a connection that already has a session. |
| `cursorExpired` | `InvalidParams` | The cursor is too old or the list changed; start again from the first page. |
| `unknownParam` | `InvalidParams` | A parameter this Sonolith does not know (it may be newer than this Sonolith). |
| `identityChanged` | `RegistrationPending` | The app identity changed (section 6.6); the user is asked to approve it again. |
| `starting` | `Unavailable` | Sonolith is still starting up. |
| `nothingPlaying` | `Unavailable` | The method needs a current item and there is none. |
| `notEditable` | `Unavailable` | The playlist cannot be changed by the user (for example, it belongs to someone else). |
| `notPlayable` | `Unavailable` | YouTube does not allow playing this item. |
| `peerUnverified` | `Unavailable` | Sonolith could not identify the calling process, so it cannot register it. |
| `tooManyPending` | `RateLimited` | Too many registration requests are already waiting for the user. |
| `tooManyInFlight` | `RateLimited` | The connection has 16 requests in flight already. |
| `tooManyConnections` | `RateLimited` | The app has 8 open connections already. |
<!-- END GENERATED: reasons -->

---

## 12. Limits

| Limit | Value | When exceeded |
|---|---|---|
| Message size | 1 MiB per message | `InvalidRequest` (`messageTooLarge`), connection closed |
| Requests in flight | 16 per connection | `RateLimited` (`tooManyInFlight`) |
| Connections | 8 per app (counted after `session.hello`) | `RateLimited` (`tooManyConnections`) on `session.hello` |
| Connections in total | 64 | new connections are closed at once |
| Time to authenticate | 30 seconds after connecting, not counting a pending registration (the 30 seconds start again when it ends) | connection closed |
| Pending registrations | 1 per app, 3 in total | `RegistrationPending` / `RateLimited` (`tooManyPending`) |
| Answer time | Sonolith answers every request within 30 seconds | `Timeout`; Sonolith stops working on the request |
| Queue | 1000 entries added per call, 5000 entries in all | the rest is left out; `truncated` and `limit` in the result say so |
| Unread outgoing data | 4 MiB per connection, or 10 seconds without reading | connection closed at once |

### 12.1 Rate limits

Every method belongs to a rate class. Each class is a token bucket per app, shared by all of its connections (the
`auth` class counts per connection). The limits protect the user's YouTube account from a buggy integration: the
`account` class, which changes the account, is the strictest.

<!-- BEGIN GENERATED: rates -->
| Class | Limit | Applies to |
|---|---|---|
| `local` | 50 per second, bursts of 100 | Reads of Sonolith's own state. `app.info`, `events.subscribe`, `events.unsubscribe`, `player.getState`, `queue.get` |
| `control` | 10 per second, bursts of 20 | Player and queue commands. `player.play`, `player.pause`, `player.toggle`, `player.next`, `player.previous`, `player.seek`, `player.setVolume`, `player.setShuffle`, `player.setRepeat`, `player.setRate`, `player.playItem`, `queue.add`, `queue.playNext`, `queue.move`, `queue.remove`, `queue.clear`, `queue.setAutoplay` |
| `network` | 2 per second, bursts of 10 | Reads that may reach YouTube or a lyrics source. `library.playlists`, `library.likedSongs`, `library.albums`, `library.artists`, `library.podcasts`, `library.episodesForLater`, `library.history`, `playlist.get`, `search.query`, `search.suggestions`, `browse.album`, `browse.artist`, `browse.podcast`, `browse.episode`, `lyrics.get` |
| `account` | 1 every 2 seconds, bursts of 5 (30 per minute) | Changes to the user's YouTube account. `playlist.create`, `playlist.rename`, `playlist.delete`, `playlist.addTracks`, `playlist.removeTracks`, `rating.set` |
| `auth` | 1 per second, bursts of 5, per connection | Registration and authentication. `app.register`, `app.requestScopes`, `app.unregister`, `session.hello` |
<!-- END GENERATED: rates -->

When a bucket is empty, the call fails with `RateLimited` and `data.retryAfterMs`. The client MUST wait at least that
long before retrying that class. A client SHOULD NOT poll: subscribe to events instead.

---

## 13. Data model

### 13.1 Items and ids

- Every item has a `type` and an `id`: `track` (a song or a music video), `episode` (a podcast episode), `album`,
  `playlist`, `artist` and `podcast` (a podcast show). Methods that take an item take a reference `{ "type", "id" }`.
- Ids are YouTube Music's ids: a video id for tracks and episodes, a channel id for artists, and browse or playlist
  ids for the rest. They are **opaque**: clients MUST NOT parse them or build them from parts. The same id string can
  mean different things with a different `type`, so always keep the type with the id.
- Ids are stable: a client MAY store them and use them later.
- The queue and a playlist can hold the same item more than once. Each occurrence is an **entry** with its own
  `entryId` (`QueueEntry`, `PlaylistEntry`), different from the item's `id`. Methods that change a list
  (`queue.move`, `queue.remove`, `playlist.removeTracks`) take `entryId`s, so exactly the occurrence you mean is
  changed. Never pass an item `id` where an `entryId` is expected.
- A client MAY use ids from YouTube Music links: `watch?v=<id>` is a track or episode, `playlist?list=<id>` a
  playlist, `browse/<id>` an album or podcast, `channel/<id>` an artist.

### 13.2 Songs, music videos and podcasts

- A **track** is a song (`video` false) or a music video (`video` true). Both play the same way.
- An **episode** is a podcast episode. Episodes have their own playback speed (`episodeRate`), a resume position and
  a played state, and no lyrics.
- A **podcast** is a show; its episodes come from [`browse.podcast`](#browsepodcast).
- Where both can appear (the queue, playlists, history), the item is a [MediaItem](#mediaitem): check `type`.

### 13.3 Null and missing

- In results and event params, **every field the schema defines is always present**. `null` means "unknown" or "not
  applicable", as each field's description says. A client MUST NOT treat a missing field as null, because a missing
  field cannot happen (except in `error.data`, see section 11).
- Clients MUST ignore fields they do not know.
- Optional **params** may be omitted; omitting one means its documented default. Sending `null` for a param is
  invalid unless its type allows null.

### 13.4 Times and numbers

- Positions and lengths are integers in milliseconds, in fields ending in `Ms` (`positionMs`, `durationMs`).
- Points in time are integers in milliseconds since the Unix epoch (UTC), in fields ending in `At` (`positionAt`,
  `expiresAt`).
- Volume is an integer from 0 to 100.

### 13.5 Text and locale

- All text from YouTube Music is in English (Sonolith requests English, `hl=en`), whatever the user's language.
- Fields ending in `Text` (`publishedText`, `subscribersText`, `sectionText`) are display strings. Clients MUST NOT
  parse them.

### 13.6 Pagination

- Lists that can be long are paged. Pass `limit` (1–100, default 50) and, for later pages, the previous result's
  `nextCursor` as `cursor`. `nextCursor` is null on the last page.
- `limit` is a maximum: a page can hold fewer items even when more follow, because YouTube delivers its own page
  sizes. Keep going until `nextCursor` is null.
- Cursors are opaque and short-lived. An old cursor (after 30 minutes, or after the list changed) fails with
  `InvalidParams` (reason `cursorExpired`): start again from the first page.

### 13.7 Artwork

`thumbnailUrl` is an HTTPS URL of the largest artwork YouTube Music offers, or null. Fetch it directly. It can change
over time; do not use it as an id.

### 13.8 Signed in or not

Sonolith works signed in to a YouTube account or signed out. Signed out, playback, the queue, search, browsing and
lyrics work; the library, ratings and playlist changes fail with `NotSignedIn`. `session.hello` and `app.info` say
whether the user is signed in; the `account` topic reports changes.

---

## 14. Security model

The API is a local, per-user service. This section says plainly what it protects and what it does not.

**It protects against:**

- **Other users on the same computer.** The socket (Linux, mode `0600` in a `0700` directory) and the pipe
  (Windows, access list for the current user only) can be opened only by the user's own processes.
- **Remote access.** There is no network listener. Windows remote pipe clients are rejected.
- **Apps the user did not approve.** Without a token there is nothing beyond `app.info`, `app.register` and
  `session.hello`. Registration needs the user's explicit approval on a screen showing the app identity.
- **Approved apps overreaching.** Every method checks the app's scopes. The user sees and controls the scopes, and
  can remove an app at any time.
- **A reused process id.** Sonolith looks at the connecting process through the operating system, and a process id
  can be given to another program once its process exits. On Linux (kernel 6.5 or newer) Sonolith holds a pidfd of
  the peer and checks that it still refers to the same process after reading its details; on older kernels it uses
  the process id from the socket credentials, which has that race. On Windows it checks that the process was created
  before the client connected. When the check fails, the call fails with `Unavailable` (reason `peerUnverified`).
- **Token reuse by a different program.** The token is bound to the app identity the user approved. A program
  with another identity presenting it triggers a new consent screen instead of access.
- **Token theft from Sonolith's data.** Sonolith stores only hashes of tokens.
- **Accidental overload.** Rate limits keep a buggy integration from hammering the user's YouTube account, and
  cooldowns and blocking keep a misbehaving app from flooding the user with consent requests.

**It does not protect against:**

- **Malware running as the same user.** A program running under the user's account can read another app's stored
  token (unless the platform's secret store prevents it), take on its identity (for example, by running the same
  interpreter with the same script path, or by setting `APPIMAGE`), read Sonolith's files, or control the user's desktop. The operating system does not
  separate a user's own programs from each other, and this API cannot either.
- **Self-declared details.** The app's name, description, publisher, homepage and icon are what the app says. Only
  the app identity comes from the operating system. The user should judge an app by its identity.
- **Interpreter-based identity is weaker.** For a script, only the interpreter's executable is verified by the
  operating system; the script path comes from the command line, which the process's starter chooses. Any script
  run by the same interpreter family with the same script path is the same app, and so is every inline-code or
  interactive session of that interpreter. Likewise an AppImage's identity rests on its `APPIMAGE` variable. This
  is acceptable within this model, because only the user's own programs can open the endpoint, and those are
  trusted no more and no less than the user's account.
- **A fake Sonolith on Windows.** Named pipes live in one namespace for all users. While Sonolith is not running,
  another user could create a pipe with the expected name and receive the tokens clients send to it. Clients reduce
  this by taking the name from `discovery.json` (in the user's private profile) and checking the server process id
  (section 3.2). On Linux, the socket directory belongs to the user, so this cannot happen.
- **What approved apps do with data.** An app with `library:read` can read the user's library and history and send
  it anywhere. The consent screen is the user's decision point.

---

## 15. Method reference

Every method uses the same template: what it does, the scope it needs, its params, its result, its errors, and an
example. The examples continue one session, so request ids increase.

<!-- BEGIN GENERATED: methods -->
### App (`app.*`)

#### `app.info`

Describes this Sonolith: API version, supported methods and topics, and the caller's session.

Works before `session.hello`, so a client can check the API version first. `session` is null until the connection is authenticated.

| Scope | Session | Rate class |
|---|---|---|
| none | not needed | `local` |

**Params**

None. Omit `params` or send `{}`.

**Result**

[ServerInfo](#serverinfo).

**Errors**

- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":1,"method":"app.info"}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "apiVersion": "1.0.0",
    "appVersion": "2.4.0",
    "platform": "linux",
    "methods": [
      "app.info",
      "app.register",
      "session.hello",
      "player.getState"
    ],
    "topics": [
      "player.state",
      "player.track",
      "player.position"
    ],
    "session": null
  }
}
```

#### `app.register`

Asks the user to let this app connect. Returns `pending` at once; the outcome arrives as `registration.resolved`.

Sonolith identifies the calling process through the operating system, shows a system notification and a consent screen, and answers with `pending`. The client MUST keep this connection open until `registration.resolved` arrives on it: if the connection closes, Sonolith cancels the request and withdraws the consent screen. A request expires after 5 minutes.

Registering an `appId` that is already registered also goes through consent. When the user approves, the old token stops working (its connections get `session.revoked` with reason `replaced`) and the new one is sent.

A client MUST call this only after a user action (for example, a "Connect to Sonolith" button), never on its own at startup or after an error.

`name`, `description`, `publisher` and each scope's `reason` are single lines of plain text: control characters (line breaks included) and invisible formatting characters (such as direction overrides or zero-width spaces) fail with `InvalidParams`.

| Scope | Session | Rate class |
|---|---|---|
| none | not needed | `auth` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `appId` | string | yes | The app's stable id. Use the same id in every version of the app. |
| `name` | string | yes | The app's name as the user knows it. 1–48 characters. |
| `description` | string | yes | What the app is, in one sentence. 1–200 characters. |
| `publisher` | string | yes | Who makes the app: a person, a team or a company. 1–64 characters. |
| `homepage` | string | no | The app's web page. `https://` only, at most 200 characters. |
| `icon` | string | no | A square PNG data URI, at most 65536 characters. No remote URLs. |
| `scopes` | [ScopeRequest](#scoperequest)[] | yes | The scopes the app wants, each with `required` and a `reason`. Each scope at most once. |
| `apiVersion` | string | yes | The API version the client was written for, for example `1.0`. |

**Result**

[RegistrationPending](#registrationpending).

**Errors**

- `Blocked` (-32006): the user blocked this app; nothing is shown to the user
- `RegistrationDenied` (-32005): the user denied a recent request; `data.retryAfterMs`
- `RegistrationPending` (-32004): another connection already has a request waiting for this `appId`
- `UnsupportedVersion` (-32013)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":2,"method":"app.register","params":{"appId":"com.example.mybar","name":"My Bar","description":"A status bar for Wayland compositors.","publisher":"Example Labs","homepage":"https://example.com/mybar","scopes":[{"scope":"player:read","required":true,"reason":"To show the current song in your bar"},{"scope":"player:control","required":false,"reason":"To play, pause and skip from your bar"}],"apiVersion":"1.0"}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "status": "pending",
    "requestId": "req_5Jt2xQ",
    "expiresAt": 1793022300000,
    "identity": {
      "kind": "executable",
      "key": "exe:/usr/bin/mybar",
      "executable": "/usr/bin/mybar",
      "interpreter": null,
      "script": null,
      "appImage": null,
      "flatpakId": null
    }
  }
}
```

#### `app.requestScopes`

Asks the user for more scopes. Shows a consent screen with only the new ones.

Scopes the app already has are ignored. When nothing new is asked, the result is `granted` and nothing is shown. Otherwise the result is `pending` and the outcome arrives as `registration.resolved` with `kind` `scopes`; on approval `session.scopesChanged` follows. The connection MUST stay open while the request is pending. Call this only after a user action.

| Scope | Session | Rate class |
|---|---|---|
| none | required | `auth` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `scopes` | [ScopeRequest](#scoperequest)[] | yes | The additional scopes, each with `required` and a `reason`. |

**Result**

[RequestScopesResult](#requestscopesresult).

**Errors**

- `RegistrationDenied` (-32005): the user denied a recent request; `data.retryAfterMs`
- `RegistrationPending` (-32004): a request for this app is already waiting
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":3,"method":"app.requestScopes","params":{"scopes":[{"scope":"lyrics:read","required":true,"reason":"To show the current lyric line in your bar"}]}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "status": "pending",
    "requestId": "req_9Wm4Lc",
    "expiresAt": 1793022300000,
    "grantedScopes": [
      "player:read",
      "player:control"
    ]
  }
}
```

#### `app.unregister`

Removes this app from Sonolith and invalidates its token.

Call this from the app's "Disconnect from Sonolith" button, then delete the stored token. Sonolith answers, shows the user "<name> disconnected from Sonolith", closes this connection, and sends `session.revoked` (reason `unregistered`) to the app's other connections.

| Scope | Session | Rate class |
|---|---|---|
| none | required | `auth` |

**Params**

None. Omit `params` or send `{}`.

**Result**

An empty object `{}`.

**Errors**

- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":4,"method":"app.unregister"}
```

Response:

```json
{"jsonrpc":"2.0","id":4,"result":{}}
```

### Session (`session.*`)

#### `session.hello`

Authenticates the connection with the app's token.

Send it first on every new connection. Sonolith checks the token and that the calling process has the app identity the user approved (section 6.6). Sonolith finishes `session.hello` before it reads the next message, so a client MAY send further requests right after it without waiting.

If the app identity changed (for example, the app was moved), the user is asked again and the call fails with `RegistrationPending` (reason `identityChanged`). Keep the connection open, wait for `registration.resolved` (`kind` `identity`), and on approval call `session.hello` again with the same token.

| Scope | Session | Rate class |
|---|---|---|
| none | not needed | `auth` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `appId` | string | yes | The id the app registered with. |
| `token` | string | yes | The token from `registration.resolved`. |
| `apiVersion` | string | yes | The API version the client was written for, for example `1.0`. |

**Result**

[HelloResult](#helloresult).

**Errors**

- `NotRegistered` (-32001): delete the token; re-register only after a user action
- `Unauthorized` (-32002): delete the token; re-register only after a user action
- `Blocked` (-32006)
- `RegistrationPending` (-32004): `identityChanged`
- `UnsupportedVersion` (-32013)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":5,"method":"session.hello","params":{"appId":"com.example.mybar","token":"snl_8dmJuD9Z2UkFfCj61pn7Zn_0hI0YOf9Cuw_XU3Uerv0","apiVersion":"1.0"}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "apiVersion": "1.0.0",
    "appVersion": "2.4.0",
    "appId": "com.example.mybar",
    "grantedScopes": [
      "player:read",
      "player:control"
    ],
    "signedIn": true,
    "identity": {
      "kind": "executable",
      "key": "exe:/usr/bin/mybar",
      "executable": "/usr/bin/mybar",
      "interpreter": null,
      "script": null,
      "appImage": null,
      "flatpakId": null
    }
  }
}
```

### Events (`events.*`)

#### `events.subscribe`

Subscribes the connection to event topics. Sends a snapshot of each new topic right after the response.

Each topic needs the scope shown in the topic table; if any topic is not allowed, the whole call fails with `PermissionDenied` and nothing changes. Subscribing to a topic the connection already has is not an error (no new snapshot is sent for it). Subscriptions belong to the connection and end with it.

| Scope | Session | Rate class |
|---|---|---|
| none | required | `local` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `topics` | [Topic](#topic)[] | yes | The topics to add. |
| `positionHz` | integer (1–4) | no | `player.position` events per second while playing, 1–4. Default 1. Applies to the whole connection. |

**Result**

[SubscribeResult](#subscriberesult).

**Errors**

- `PermissionDenied` (-32003): `data.scope` names the missing scope
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":6,"method":"events.subscribe","params":{"topics":["player.state","player.position","lyrics.line"],"positionHz":2}}
```

Response:

```json
{"jsonrpc":"2.0","id":6,"result":{"topics":["player.state","player.position","lyrics.line"],"positionHz":2}}
```

#### `events.unsubscribe`

Removes topics from the connection's subscriptions.

| Scope | Session | Rate class |
|---|---|---|
| none | required | `local` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `topics` | [Topic](#topic)[] | yes | The topics to remove. Topics the connection does not have are ignored. |

**Result**

[SubscribeResult](#subscriberesult).

**Errors**

- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":7,"method":"events.unsubscribe","params":{"topics":["lyrics.line"]}}
```

Response:

```json
{"jsonrpc":"2.0","id":7,"result":{"topics":["player.state","player.position"],"positionHz":2}}
```

### Player (`player.*`)

#### `player.getState`

Returns the full player state.

| Scope | Session | Rate class |
|---|---|---|
| `player:read` | required | `local` |

**Params**

None. Omit `params` or send `{}`.

**Result**

[PlayerState](#playerstate).

**Errors**

- `PermissionDenied` (-32003): the app lacks `player:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":8,"method":"player.getState"}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "result": {
    "status": "playing",
    "item": {
      "type": "track",
      "id": "Xk3vT9pQm2A",
      "title": "Glass Harbor",
      "artists": [
        {
          "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
          "name": "Northern Static"
        }
      ],
      "album": {
        "id": "MPREb_4pL8gzRtw9a",
        "title": "Low Tide Radio"
      },
      "durationMs": 214000,
      "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
      "explicit": false,
      "video": false,
      "rating": "like"
    },
    "positionMs": 61250,
    "positionAt": 1793022000000,
    "durationMs": 214000,
    "volume": 70,
    "muted": false,
    "shuffle": false,
    "repeat": "off",
    "rate": 1,
    "episodeRate": 1.25,
    "canGoNext": true,
    "canGoPrevious": true,
    "queueIndex": 3,
    "queueLength": 25,
    "autoplay": true
  }
}
```

#### `player.play`

Starts or resumes playback.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

None. Omit `params` or send `{}`.

**Result**

An empty object `{}`.

**Errors**

- `Unavailable` (-32010): `nothingPlaying`: the queue is empty
- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":9,"method":"player.play"}
```

Response:

```json
{"jsonrpc":"2.0","id":9,"result":{}}
```

#### `player.pause`

Pauses playback. Pausing while paused is not an error.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

None. Omit `params` or send `{}`.

**Result**

An empty object `{}`.

**Errors**

- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":10,"method":"player.pause"}
```

Response:

```json
{"jsonrpc":"2.0","id":10,"result":{}}
```

#### `player.toggle`

Plays when paused, pauses when playing.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

None. Omit `params` or send `{}`.

**Result**

An empty object `{}`.

**Errors**

- `Unavailable` (-32010): `nothingPlaying`
- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":11,"method":"player.toggle"}
```

Response:

```json
{"jsonrpc":"2.0","id":11,"result":{}}
```

#### `player.next`

Skips to the next item in the queue.

With repeat `all` it wraps to the first item; with autoplay on, Sonolith may first add related tracks.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

None. Omit `params` or send `{}`.

**Result**

An empty object `{}`.

**Errors**

- `Unavailable` (-32010): `nothingPlaying`; also when there is no next item (`canGoNext` is false)
- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":12,"method":"player.next"}
```

Response:

```json
{"jsonrpc":"2.0","id":12,"result":{}}
```

#### `player.previous`

Goes back like the Previous button: restarts the current item when more than 3 seconds have played, otherwise plays the previous item.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

None. Omit `params` or send `{}`.

**Result**

An empty object `{}`.

**Errors**

- `Unavailable` (-32010): `nothingPlaying`
- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":13,"method":"player.previous"}
```

Response:

```json
{"jsonrpc":"2.0","id":13,"result":{}}
```

#### `player.seek`

Seeks in the current item. Pass exactly one of `positionMs` and `offsetMs`.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `positionMs` | integer (ms) | no | The position to seek to. Clamped to the item's length. |
| `offsetMs` | integer | no | A relative jump; negative goes back. The result is clamped to the item. |

**Result**

An empty object `{}`.

**Errors**

- `Unavailable` (-32010): `nothingPlaying`
- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":14,"method":"player.seek","params":{"positionMs":90000}}
```

Response:

```json
{"jsonrpc":"2.0","id":14,"result":{}}
```

#### `player.setVolume`

Sets the volume, mute, or both. Pass at least one.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `volume` | [Volume](#volume) | no | The volume, 0–100. Setting a volume above 0 also unmutes. |
| `muted` | boolean | no | Mute or unmute. |

**Result**

An empty object `{}`.

**Errors**

- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":15,"method":"player.setVolume","params":{"volume":55}}
```

Response:

```json
{"jsonrpc":"2.0","id":15,"result":{}}
```

#### `player.setShuffle`

Turns shuffle on or off.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `enabled` | boolean | yes |  |

**Result**

An empty object `{}`.

**Errors**

- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":16,"method":"player.setShuffle","params":{"enabled":true}}
```

Response:

```json
{"jsonrpc":"2.0","id":16,"result":{}}
```

#### `player.setRepeat`

Sets the repeat mode.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `mode` | [RepeatMode](#repeatmode) | yes | `off`, `all` (repeat the queue) or `one` (repeat the current item). |

**Result**

An empty object `{}`.

**Errors**

- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":17,"method":"player.setRepeat","params":{"mode":"all"}}
```

Response:

```json
{"jsonrpc":"2.0","id":17,"result":{}}
```

#### `player.setRate`

Sets the playback speed for podcast episodes. Tracks always play at 1.

The speed is a Sonolith setting: it applies to the current episode at once and to every episode after it. Setting it while a track plays is allowed and takes effect at the next episode.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `rate` | [EpisodeRate](#episoderate) | yes | One of the listed speeds. |

**Result**

An empty object `{}`.

**Errors**

- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":18,"method":"player.setRate","params":{"rate":1.5}}
```

Response:

```json
{"jsonrpc":"2.0","id":18,"result":{}}
```

#### `player.playItem`

Plays a track, episode, album, playlist or podcast. Replaces the queue.

A track or episode starts a new queue with that item; with autoplay on, Sonolith continues with related tracks. An album, playlist or podcast fills the queue with its items in order (a podcast: its episodes, newest first), at most 500; `truncated` is true when it has more. An episode resumes where the user left off unless `positionMs` is given.

| Scope | Session | Rate class |
|---|---|---|
| `player:control` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `item` | [PlayableRef](#playableref) | yes | What to play. |
| `startId` | string | no | For an album, playlist or podcast: the id of the track or episode to start with. Default: the first. |
| `shuffle` | boolean | no | For an album, playlist or podcast: shuffle it and turn shuffle on. Default false. |
| `positionMs` | integer (ms) | no | Where to start in the first item. |

**Result**

| Field | Type | Description |
|---|---|---|
| `truncated` | boolean | True when the album, playlist or podcast has more than `limit` items, so the queue got only the first `limit`. |
| `limit` | integer (0–500) | The most items one album, playlist or podcast puts in the queue: 500. |

**Errors**

- `NotFound` (-32008): the item does not exist, or it is the user's own playlist, liked songs, episodes for later or a personal mix while the app lacks `library:read` (see `playlist.get`)
- `Unavailable` (-32010): `notPlayable`
- `PermissionDenied` (-32003): the app lacks `player:control`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":19,"method":"player.playItem","params":{"item":{"type":"album","id":"MPREb_4pL8gzRtw9a"},"startId":"Rb7nW2kLq9E"}}
```

Response:

```json
{"jsonrpc":"2.0","id":19,"result":{"truncated":false,"limit":500}}
```

### Queue (`queue.*`)

#### `queue.get`

Returns the queue, one page at a time.

A cursor is tied to the queue's `revision`. If the queue changes between pages, the next page fails with `InvalidParams` (`cursorExpired`); start again.

| Scope | Session | Rate class |
|---|---|---|
| `queue:read` | required | `local` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `fromIndex` | integer | no | Start at this index instead of 0, for example `currentIndex` to get what plays next. Ignored with `cursor`. |
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

All fields of [QueueSummary](#queuesummary), plus:

| Field | Type | Description |
|---|---|---|
| `items` | [QueueEntry](#queueentry)[] | The entries of this page, in queue order. |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `PermissionDenied` (-32003): the app lacks `queue:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":20,"method":"queue.get","params":{"fromIndex":3,"limit":2}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 20,
  "result": {
    "revision": 57,
    "currentIndex": 3,
    "length": 25,
    "autoplay": true,
    "items": [
      {
        "index": 3,
        "entryId": "q_118",
        "item": {
          "type": "track",
          "id": "Xk3vT9pQm2A",
          "title": "Glass Harbor",
          "artists": [
            {
              "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
              "name": "Northern Static"
            }
          ],
          "album": {
            "id": "MPREb_4pL8gzRtw9a",
            "title": "Low Tide Radio"
          },
          "durationMs": 214000,
          "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
          "explicit": false,
          "video": false,
          "rating": "like"
        },
        "autoplay": false
      },
      {
        "index": 4,
        "entryId": "q_119",
        "item": {
          "type": "track",
          "id": "Rb7nW2kLq9E",
          "title": "Paper Satellites",
          "artists": [
            {
              "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
              "name": "Northern Static"
            }
          ],
          "album": {
            "id": "MPREb_4pL8gzRtw9a",
            "title": "Low Tide Radio"
          },
          "durationMs": 187000,
          "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
          "explicit": false,
          "video": false,
          "rating": "none"
        },
        "autoplay": true
      }
    ],
    "nextCursor": "cXVldWU6NTc6NQ"
  }
}
```

#### `queue.add`

Adds items to the end of the queue.

An album, playlist or podcast adds all its items (at most 500). If autoplay entries are at the end, the new items go before them. One call adds at most 1000 entries and never grows the queue past 5000 entries; items beyond that are left out (and not looked up): then `truncated` is true, and `limit` says how many entries the call could add.

| Scope | Session | Rate class |
|---|---|---|
| `queue:write` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `items` | [PlayableRef](#playableref)[] | yes | What to add, in order. |

**Result**

| Field | Type | Description |
|---|---|---|
| `added` | integer | How many entries were added. |
| `truncated` | boolean | True when the limits left items out (1000 entries per call, 5000 in the queue). |
| `limit` | integer (0–1000) | How many entries this call could add: 1000, or fewer when the queue is close to 5000. |
| `queue` | [QueueSummary](#queuesummary) | The queue's shape without its items. |

**Errors**

- `NotFound` (-32008): one of the items does not exist, or is the user's own playlist, liked songs, episodes for later or a personal mix while the app lacks `library:read` (see `playlist.get`); nothing is added
- `PermissionDenied` (-32003): the app lacks `queue:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":21,"method":"queue.add","params":{"items":[{"type":"track","id":"Rb7nW2kLq9E"}]}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 21,
  "result": {
    "added": 1,
    "truncated": false,
    "limit": 1000,
    "queue": {
      "revision": 58,
      "currentIndex": 3,
      "length": 26,
      "autoplay": true
    }
  }
}
```

#### `queue.playNext`

Inserts items right after the current item.

The same limits as `queue.add`: at most 500 items per album, playlist or podcast, 1000 entries per call, and a queue of at most 5000 entries.

| Scope | Session | Rate class |
|---|---|---|
| `queue:write` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `items` | [PlayableRef](#playableref)[] | yes | What to insert, in order. |

**Result**

| Field | Type | Description |
|---|---|---|
| `added` | integer | How many entries were added. |
| `truncated` | boolean | True when the limits left items out (1000 entries per call, 5000 in the queue). |
| `limit` | integer (0–1000) | How many entries this call could add: 1000, or fewer when the queue is close to 5000. |
| `queue` | [QueueSummary](#queuesummary) | The queue's shape without its items. |

**Errors**

- `NotFound` (-32008): one of the items does not exist, or is the user's own playlist, liked songs, episodes for later or a personal mix while the app lacks `library:read` (see `playlist.get`); nothing is added
- `PermissionDenied` (-32003): the app lacks `queue:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":22,"method":"queue.playNext","params":{"items":[{"type":"album","id":"MPREb_4pL8gzRtw9a"}]}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 22,
  "result": {
    "added": 10,
    "truncated": false,
    "limit": 1000,
    "queue": {
      "revision": 58,
      "currentIndex": 3,
      "length": 35,
      "autoplay": true
    }
  }
}
```

#### `queue.move`

Moves one entry to a new index.

| Scope | Session | Rate class |
|---|---|---|
| `queue:write` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `entryId` | string | yes | The entry to move. |
| `toIndex` | integer | yes | Its index after the move. Clamped to the queue. |

**Result**

| Field | Type | Description |
|---|---|---|
| `queue` | [QueueSummary](#queuesummary) | The queue's shape without its items. |

**Errors**

- `NotFound` (-32008): no entry with this `entryId`
- `PermissionDenied` (-32003): the app lacks `queue:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":23,"method":"queue.move","params":{"entryId":"q_119","toIndex":4}}
```

Response:

```json
{"jsonrpc":"2.0","id":23,"result":{"queue":{"revision":59,"currentIndex":3,"length":25,"autoplay":true}}}
```

#### `queue.remove`

Removes entries from the queue.

Removing the current entry plays the next one (or stops at the end). Unknown `entryIds` are ignored.

| Scope | Session | Rate class |
|---|---|---|
| `queue:write` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `entryIds` | string[] | yes | The entries to remove. |

**Result**

| Field | Type | Description |
|---|---|---|
| `removed` | integer |  |
| `queue` | [QueueSummary](#queuesummary) | The queue's shape without its items. |

**Errors**

- `PermissionDenied` (-32003): the app lacks `queue:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":24,"method":"queue.remove","params":{"entryIds":["q_119"]}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 24,
  "result": {
    "removed": 1,
    "queue": {
      "revision": 60,
      "currentIndex": 3,
      "length": 24,
      "autoplay": true
    }
  }
}
```

#### `queue.clear`

Removes every entry except the current one. Playback continues.

| Scope | Session | Rate class |
|---|---|---|
| `queue:write` | required | `control` |

**Params**

None. Omit `params` or send `{}`.

**Result**

| Field | Type | Description |
|---|---|---|
| `queue` | [QueueSummary](#queuesummary) | The queue's shape without its items. |

**Errors**

- `PermissionDenied` (-32003): the app lacks `queue:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":25,"method":"queue.clear"}
```

Response:

```json
{"jsonrpc":"2.0","id":25,"result":{"queue":{"revision":61,"currentIndex":0,"length":1,"autoplay":true}}}
```

#### `queue.setAutoplay`

Turns autoplay on or off.

Turning it off removes the autoplay entries that have not played yet.

| Scope | Session | Rate class |
|---|---|---|
| `queue:write` | required | `control` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `enabled` | boolean | yes |  |

**Result**

| Field | Type | Description |
|---|---|---|
| `queue` | [QueueSummary](#queuesummary) | The queue's shape without its items. |

**Errors**

- `PermissionDenied` (-32003): the app lacks `queue:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":26,"method":"queue.setAutoplay","params":{"enabled":false}}
```

Response:

```json
{"jsonrpc":"2.0","id":26,"result":{"queue":{"revision":62,"currentIndex":3,"length":12,"autoplay":false}}}
```

### Library (`library.*`)

#### `library.playlists`

Lists the playlists in the user's library.

| Scope | Session | Rate class |
|---|---|---|
| `library:read` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `items` | [Playlist](#playlist)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `NotSignedIn` (-32007)
- `PermissionDenied` (-32003): the app lacks `library:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":27,"method":"library.playlists","params":{"limit":1}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 27,
  "result": {
    "items": [
      {
        "type": "playlist",
        "id": "PLx9KmQ2vT7bN4cR8wZ3yL5aD1fG6hJ0eS",
        "title": "Late Night Drive",
        "author": "You",
        "trackCount": 38,
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "editable": true
      }
    ],
    "nextCursor": "bGliOnBsOjE"
  }
}
```

#### `library.likedSongs`

Lists the user's liked songs, newest first.

| Scope | Session | Rate class |
|---|---|---|
| `library:read` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `items` | [MediaItem](#mediaitem)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `NotSignedIn` (-32007)
- `PermissionDenied` (-32003): the app lacks `library:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":28,"method":"library.likedSongs","params":{"limit":1}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 28,
  "result": {
    "items": [
      {
        "type": "track",
        "id": "Xk3vT9pQm2A",
        "title": "Glass Harbor",
        "artists": [
          {
            "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
            "name": "Northern Static"
          }
        ],
        "album": {
          "id": "MPREb_4pL8gzRtw9a",
          "title": "Low Tide Radio"
        },
        "durationMs": 214000,
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "explicit": false,
        "video": false,
        "rating": "like"
      }
    ],
    "nextCursor": "bGliOmxpa2VkOjE"
  }
}
```

#### `library.albums`

Lists the albums in the user's library.

| Scope | Session | Rate class |
|---|---|---|
| `library:read` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `items` | [Album](#album)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `NotSignedIn` (-32007)
- `PermissionDenied` (-32003): the app lacks `library:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":29,"method":"library.albums","params":{"limit":1}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 29,
  "result": {
    "items": [
      {
        "type": "album",
        "id": "MPREb_4pL8gzRtw9a",
        "title": "Low Tide Radio",
        "artists": [
          {
            "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
            "name": "Northern Static"
          }
        ],
        "albumType": "album",
        "year": 2025,
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "explicit": false
      }
    ],
    "nextCursor": null
  }
}
```

#### `library.artists`

Lists the artists in the user's library.

| Scope | Session | Rate class |
|---|---|---|
| `library:read` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `items` | [Artist](#artist)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `NotSignedIn` (-32007)
- `PermissionDenied` (-32003): the app lacks `library:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":30,"method":"library.artists","params":{}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 30,
  "result": {
    "items": [
      {
        "type": "artist",
        "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
        "name": "Northern Static",
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "subscribersText": "182K subscribers"
      }
    ],
    "nextCursor": null
  }
}
```

#### `library.podcasts`

Lists the podcast shows in the user's library.

| Scope | Session | Rate class |
|---|---|---|
| `library:read` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `items` | [Podcast](#podcast)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `NotSignedIn` (-32007)
- `PermissionDenied` (-32003): the app lacks `library:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":31,"method":"library.podcasts","params":{}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 31,
  "result": {
    "items": [
      {
        "type": "podcast",
        "id": "PLp4dC8sT2mVx7Kq9wZ3nB5yR1gF6hJ0aE",
        "title": "The Long Signal",
        "author": "Long Signal Media",
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544"
      }
    ],
    "nextCursor": null
  }
}
```

#### `library.episodesForLater`

Lists the episodes the user saved for later.

| Scope | Session | Rate class |
|---|---|---|
| `library:read` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `items` | [Episode](#episode)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `NotSignedIn` (-32007)
- `PermissionDenied` (-32003): the app lacks `library:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":32,"method":"library.episodesForLater","params":{}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 32,
  "result": {
    "items": [
      {
        "type": "episode",
        "id": "Lm8Qw2Xc7Vb",
        "title": "Episode 42: Signals in the Noise",
        "podcast": {
          "id": "PLp4dC8sT2mVx7Kq9wZ3nB5yR1gF6hJ0aE",
          "title": "The Long Signal"
        },
        "author": "Long Signal Media",
        "durationMs": 3412000,
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "publishedText": "Mar 3, 2026",
        "played": false,
        "resumePositionMs": 1260000
      }
    ],
    "nextCursor": null
  }
}
```

#### `library.history`

Lists the user's listening history, newest first.

| Scope | Session | Rate class |
|---|---|---|
| `library:read` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `items` | [HistoryEntry](#historyentry)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `NotSignedIn` (-32007)
- `PermissionDenied` (-32003): the app lacks `library:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":33,"method":"library.history","params":{"limit":2}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 33,
  "result": {
    "items": [
      {
        "item": {
          "type": "track",
          "id": "Xk3vT9pQm2A",
          "title": "Glass Harbor",
          "artists": [
            {
              "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
              "name": "Northern Static"
            }
          ],
          "album": {
            "id": "MPREb_4pL8gzRtw9a",
            "title": "Low Tide Radio"
          },
          "durationMs": 214000,
          "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
          "explicit": false,
          "video": false,
          "rating": "like"
        },
        "sectionText": "Today"
      },
      {
        "item": {
          "type": "episode",
          "id": "Lm8Qw2Xc7Vb",
          "title": "Episode 42: Signals in the Noise",
          "podcast": {
            "id": "PLp4dC8sT2mVx7Kq9wZ3nB5yR1gF6hJ0aE",
            "title": "The Long Signal"
          },
          "author": "Long Signal Media",
          "durationMs": 3412000,
          "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
          "publishedText": "Mar 3, 2026",
          "played": false,
          "resumePositionMs": 1260000
        },
        "sectionText": "Yesterday"
      }
    ],
    "nextCursor": "aGlzdDoy"
  }
}
```

### Playlists (`playlist.*`)

#### `playlist.get`

Returns a playlist and its items, one page at a time.

With `library:read`, any playlist the user can see works, including private ones and liked songs. With only `search`, only other people's public and unlisted playlists work; the user's own playlists (also public ones), liked songs, episodes for later and the mixes made from the user's listening give `NotFound`. An id with YouTube's `VL` prefix (`VLPL…`) is the same playlist as without it.

Every item comes as an entry with its own `entryId`. A song that is in the playlist twice is two entries with the same `item.id` and different `entryId`s.

| Scope | Session | Rate class |
|---|---|---|
| `library:read` or `search` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | The playlist id. |
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `playlist` | [PlaylistDetail](#playlistdetail) | The playlist; repeated on every page. |
| `items` | [PlaylistEntry](#playlistentry)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `NotFound` (-32008)
- `PermissionDenied` (-32003): the app lacks `library:read` or `search`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":34,"method":"playlist.get","params":{"id":"PLx9KmQ2vT7bN4cR8wZ3yL5aD1fG6hJ0eS","limit":3}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 34,
  "result": {
    "playlist": {
      "type": "playlist",
      "id": "PLx9KmQ2vT7bN4cR8wZ3yL5aD1fG6hJ0eS",
      "title": "Late Night Drive",
      "author": "You",
      "trackCount": 38,
      "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
      "editable": true,
      "description": "For the long way home.",
      "privacy": "private"
    },
    "items": [
      {
        "entryId": "56B44F6D10557CC6",
        "item": {
          "type": "track",
          "id": "Xk3vT9pQm2A",
          "title": "Glass Harbor",
          "artists": [
            {
              "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
              "name": "Northern Static"
            }
          ],
          "album": {
            "id": "MPREb_4pL8gzRtw9a",
            "title": "Low Tide Radio"
          },
          "durationMs": 214000,
          "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
          "explicit": false,
          "video": false,
          "rating": "like"
        }
      },
      {
        "entryId": "3A9E5D0C7B21F48A",
        "item": {
          "type": "track",
          "id": "Rb7nW2kLq9E",
          "title": "Paper Satellites",
          "artists": [
            {
              "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
              "name": "Northern Static"
            }
          ],
          "album": {
            "id": "MPREb_4pL8gzRtw9a",
            "title": "Low Tide Radio"
          },
          "durationMs": 187000,
          "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
          "explicit": false,
          "video": false,
          "rating": "none"
        }
      },
      {
        "entryId": "C41D8F7A60B3E952",
        "item": {
          "type": "track",
          "id": "Xk3vT9pQm2A",
          "title": "Glass Harbor",
          "artists": [
            {
              "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
              "name": "Northern Static"
            }
          ],
          "album": {
            "id": "MPREb_4pL8gzRtw9a",
            "title": "Low Tide Radio"
          },
          "durationMs": 214000,
          "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
          "explicit": false,
          "video": false,
          "rating": "like"
        }
      }
    ],
    "nextCursor": "cGw6Mw"
  }
}
```

#### `playlist.create`

Creates a playlist in the user's library.

| Scope | Session | Rate class |
|---|---|---|
| `library:write` | required | `account` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | 1–150 characters. |
| `description` | string | no | At most 5000 characters. |
| `privacy` | "public" \| "unlisted" \| "private" | no | Default `private`. |
| `items` | [MediaRef](#mediaref)[] | no | Tracks or episodes to put in it, in order. |

**Result**

[Playlist](#playlist).

**Errors**

- `NotSignedIn` (-32007)
- `NotFound` (-32008): one of the items does not exist; nothing is created
- `PermissionDenied` (-32003): the app lacks `library:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":35,"method":"playlist.create","params":{"title":"Bar picks","items":[{"type":"track","id":"Xk3vT9pQm2A"}]}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 35,
  "result": {
    "type": "playlist",
    "id": "PLr2Vw8Nq4Kd7Ls1Xc9Bz3Mf6Ht5Jy0Ga",
    "title": "Bar picks",
    "author": "You",
    "trackCount": 1,
    "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
    "editable": true
  }
}
```

#### `playlist.rename`

Renames a playlist the user owns.

| Scope | Session | Rate class |
|---|---|---|
| `library:write` | required | `account` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | A YouTube id. |
| `title` | string | yes | The new title, 1–150 characters. |

**Result**

An empty object `{}`.

**Errors**

- `NotSignedIn` (-32007)
- `NotFound` (-32008)
- `Unavailable` (-32010): `notEditable`
- `PermissionDenied` (-32003): the app lacks `library:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":36,"method":"playlist.rename","params":{"id":"PLx9KmQ2vT7bN4cR8wZ3yL5aD1fG6hJ0eS","title":"Later Night Drive"}}
```

Response:

```json
{"jsonrpc":"2.0","id":36,"result":{}}
```

#### `playlist.delete`

Deletes a playlist the user owns. This cannot be undone.

| Scope | Session | Rate class |
|---|---|---|
| `library:write` | required | `account` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | A YouTube id. |

**Result**

An empty object `{}`.

**Errors**

- `NotSignedIn` (-32007)
- `NotFound` (-32008)
- `Unavailable` (-32010): `notEditable`
- `PermissionDenied` (-32003): the app lacks `library:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":37,"method":"playlist.delete","params":{"id":"PLr2Vw8Nq4Kd7Ls1Xc9Bz3Mf6Ht5Jy0Ga"}}
```

Response:

```json
{"jsonrpc":"2.0","id":37,"result":{}}
```

#### `playlist.addTracks`

Adds tracks or episodes to the end of a playlist the user owns.

| Scope | Session | Rate class |
|---|---|---|
| `library:write` | required | `account` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | The playlist id. |
| `items` | [MediaRef](#mediaref)[] | yes | What to add, in order. |
| `allowDuplicates` | boolean | no | Add items the playlist already has. Default false: they are skipped. |

**Result**

| Field | Type | Description |
|---|---|---|
| `added` | integer |  |
| `skipped` | integer | Items skipped as duplicates. |

**Errors**

- `NotSignedIn` (-32007)
- `NotFound` (-32008)
- `Unavailable` (-32010): `notEditable`
- `PermissionDenied` (-32003): the app lacks `library:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":38,"method":"playlist.addTracks","params":{"id":"PLx9KmQ2vT7bN4cR8wZ3yL5aD1fG6hJ0eS","items":[{"type":"track","id":"Rb7nW2kLq9E"},{"type":"track","id":"Xk3vT9pQm2A"}]}}
```

Response:

```json
{"jsonrpc":"2.0","id":38,"result":{"added":1,"skipped":1}}
```

#### `playlist.removeTracks`

Removes entries from a playlist the user owns.

Removes exactly the entries named by `entryIds`, nothing else: a song that is in the playlist twice loses only the copy whose `entryId` you pass. Ids the playlist does not have (already removed, or an item id instead of an `entryId`) are ignored, and `removed` counts the entries that were removed. Entry ids come from `playlist.get`; remove duplicates one `entryId` at a time or together.

| Scope | Session | Rate class |
|---|---|---|
| `library:write` | required | `account` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | The playlist id. |
| `entryIds` | string[] | yes | `entryId` values from `playlist.get`, not item ids. |

**Result**

| Field | Type | Description |
|---|---|---|
| `removed` | integer | How many of the entries were removed. |

**Errors**

- `NotSignedIn` (-32007)
- `NotFound` (-32008)
- `Unavailable` (-32010): `notEditable`
- `PermissionDenied` (-32003): the app lacks `library:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":39,"method":"playlist.removeTracks","params":{"id":"PLx9KmQ2vT7bN4cR8wZ3yL5aD1fG6hJ0eS","entryIds":["56B44F6D10557CC6"]}}
```

Response:

```json
{"jsonrpc":"2.0","id":39,"result":{"removed":1}}
```

### Search (`search.*`)

#### `search.query`

Searches YouTube Music.

With `type` `all` the result is one page of mixed items (the best matches of each kind) plus an optional `topResult`, and `nextCursor` is always null. With any other `type` the results are paged and `topResult` is null.

| Scope | Session | Rate class |
|---|---|---|
| `search` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | The search text, 1–200 characters. |
| `type` | "all" \| "songs" \| "videos" \| "albums" \| "artists" \| "playlists" \| "podcasts" \| "episodes" | no | What to search for. Default `all`. |
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `topResult` | [Item](#item) \| null | The best match when `type` is `all`, otherwise null. |
| `items` | [Item](#item)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `PermissionDenied` (-32003): the app lacks `search`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":40,"method":"search.query","params":{"query":"northern static glass harbor","type":"songs","limit":1}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 40,
  "result": {
    "topResult": null,
    "items": [
      {
        "type": "track",
        "id": "Xk3vT9pQm2A",
        "title": "Glass Harbor",
        "artists": [
          {
            "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
            "name": "Northern Static"
          }
        ],
        "album": {
          "id": "MPREb_4pL8gzRtw9a",
          "title": "Low Tide Radio"
        },
        "durationMs": 214000,
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "explicit": false,
        "video": false,
        "rating": "like"
      }
    ],
    "nextCursor": "c3JjaDoxOjE"
  }
}
```

#### `search.suggestions`

Returns search suggestions for partial text.

| Scope | Session | Rate class |
|---|---|---|
| `search` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | The text typed so far. |

**Result**

| Field | Type | Description |
|---|---|---|
| `queries` | string[] | Suggested search texts. |
| `items` | [Item](#item)[] | Suggested items. |

**Errors**

- `PermissionDenied` (-32003): the app lacks `search`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":41,"method":"search.suggestions","params":{"query":"northern sta"}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 41,
  "result": {
    "queries": [
      "northern static",
      "northern static glass harbor"
    ],
    "items": [
      {
        "type": "artist",
        "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
        "name": "Northern Static",
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "subscribersText": "182K subscribers"
      }
    ]
  }
}
```

### Browse (`browse.*`)

#### `browse.album`

Returns an album with all its tracks.

| Scope | Session | Rate class |
|---|---|---|
| `search` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | The album id. |

**Result**

[AlbumDetail](#albumdetail).

**Errors**

- `NotFound` (-32008)
- `PermissionDenied` (-32003): the app lacks `search`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":42,"method":"browse.album","params":{"id":"MPREb_4pL8gzRtw9a"}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 42,
  "result": {
    "type": "album",
    "id": "MPREb_4pL8gzRtw9a",
    "title": "Low Tide Radio",
    "artists": [
      {
        "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
        "name": "Northern Static"
      }
    ],
    "albumType": "album",
    "year": 2025,
    "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
    "explicit": false,
    "description": null,
    "trackCount": 2,
    "durationMs": 401000,
    "tracks": [
      {
        "type": "track",
        "id": "Xk3vT9pQm2A",
        "title": "Glass Harbor",
        "artists": [
          {
            "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
            "name": "Northern Static"
          }
        ],
        "album": {
          "id": "MPREb_4pL8gzRtw9a",
          "title": "Low Tide Radio"
        },
        "durationMs": 214000,
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "explicit": false,
        "video": false,
        "rating": "like"
      },
      {
        "type": "track",
        "id": "Rb7nW2kLq9E",
        "title": "Paper Satellites",
        "artists": [
          {
            "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
            "name": "Northern Static"
          }
        ],
        "album": {
          "id": "MPREb_4pL8gzRtw9a",
          "title": "Low Tide Radio"
        },
        "durationMs": 187000,
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "explicit": false,
        "video": false,
        "rating": "none"
      }
    ]
  }
}
```

#### `browse.artist`

Returns an artist page: description and shelves (top songs, albums, singles, videos, related artists, …).

| Scope | Session | Rate class |
|---|---|---|
| `search` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | The artist's channel id. |

**Result**

[ArtistDetail](#artistdetail).

**Errors**

- `NotFound` (-32008)
- `PermissionDenied` (-32003): the app lacks `search`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":43,"method":"browse.artist","params":{"id":"UCq7kZ3mX9vYbL2nT5cR8wQA"}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 43,
  "result": {
    "type": "artist",
    "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
    "name": "Northern Static",
    "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
    "subscribersText": "182K subscribers",
    "description": "Dream pop from the coast.",
    "sections": [
      {
        "kind": "songs",
        "title": "Top songs",
        "items": [
          {
            "type": "track",
            "id": "Xk3vT9pQm2A",
            "title": "Glass Harbor",
            "artists": [
              {
                "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
                "name": "Northern Static"
              }
            ],
            "album": {
              "id": "MPREb_4pL8gzRtw9a",
              "title": "Low Tide Radio"
            },
            "durationMs": 214000,
            "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
            "explicit": false,
            "video": false,
            "rating": "like"
          }
        ]
      },
      {
        "kind": "albums",
        "title": "Albums",
        "items": [
          {
            "type": "album",
            "id": "MPREb_4pL8gzRtw9a",
            "title": "Low Tide Radio",
            "artists": [
              {
                "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
                "name": "Northern Static"
              }
            ],
            "albumType": "album",
            "year": 2025,
            "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
            "explicit": false
          }
        ]
      }
    ]
  }
}
```

#### `browse.podcast`

Returns a podcast show and its episodes, newest first, one page at a time.

| Scope | Session | Rate class |
|---|---|---|
| `search` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | The podcast id. |
| `cursor` | string | no | The `nextCursor` of the previous page. Omit for the first page. |
| `limit` | integer (1–100) | no | The maximum number of items. Default 50. |

**Result**

| Field | Type | Description |
|---|---|---|
| `podcast` | [PodcastDetail](#podcastdetail) | The show; repeated on every page. |
| `items` | [Episode](#episode)[] |  |
| `nextCursor` | string \| null | The cursor for the next page, or null when this is the last page. |

**Errors**

- `NotFound` (-32008)
- `PermissionDenied` (-32003): the app lacks `search`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":44,"method":"browse.podcast","params":{"id":"PLp4dC8sT2mVx7Kq9wZ3nB5yR1gF6hJ0aE","limit":1}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 44,
  "result": {
    "podcast": {
      "type": "podcast",
      "id": "PLp4dC8sT2mVx7Kq9wZ3nB5yR1gF6hJ0aE",
      "title": "The Long Signal",
      "author": "Long Signal Media",
      "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
      "description": "Conversations about sound and radio."
    },
    "items": [
      {
        "type": "episode",
        "id": "Lm8Qw2Xc7Vb",
        "title": "Episode 42: Signals in the Noise",
        "podcast": {
          "id": "PLp4dC8sT2mVx7Kq9wZ3nB5yR1gF6hJ0aE",
          "title": "The Long Signal"
        },
        "author": "Long Signal Media",
        "durationMs": 3412000,
        "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
        "publishedText": "Mar 3, 2026",
        "played": false,
        "resumePositionMs": 1260000
      }
    ],
    "nextCursor": "cG9kOjE"
  }
}
```

#### `browse.episode`

Returns an episode with its description.

| Scope | Session | Rate class |
|---|---|---|
| `search` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | The episode id. |

**Result**

[EpisodeDetail](#episodedetail).

**Errors**

- `NotFound` (-32008)
- `PermissionDenied` (-32003): the app lacks `search`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":45,"method":"browse.episode","params":{"id":"Lm8Qw2Xc7Vb"}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 45,
  "result": {
    "type": "episode",
    "id": "Lm8Qw2Xc7Vb",
    "title": "Episode 42: Signals in the Noise",
    "podcast": {
      "id": "PLp4dC8sT2mVx7Kq9wZ3nB5yR1gF6hJ0aE",
      "title": "The Long Signal"
    },
    "author": "Long Signal Media",
    "durationMs": 3412000,
    "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
    "publishedText": "Mar 3, 2026",
    "played": false,
    "resumePositionMs": 1260000,
    "description": "Where radio static comes from, and why we keep listening."
  }
}
```

### Ratings (`rating.*`)

#### `rating.set`

Likes, dislikes or clears the rating of an item.

For a track or episode, `like` adds it to liked songs. For an album, playlist or podcast, `like` saves it to the library and `none` removes it; `dislike` is not allowed for them (`InvalidParams`).

| Scope | Session | Rate class |
|---|---|---|
| `library:write` | required | `account` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `item` | [RateableRef](#rateableref) | yes | What to rate. |
| `rating` | [Rating](#rating) | yes | The user's rating. |

**Result**

An empty object `{}`.

**Errors**

- `NotSignedIn` (-32007)
- `NotFound` (-32008)
- `PermissionDenied` (-32003): the app lacks `library:write`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":46,"method":"rating.set","params":{"item":{"type":"track","id":"Xk3vT9pQm2A"},"rating":"like"}}
```

Response:

```json
{"jsonrpc":"2.0","id":46,"result":{}}
```

### Lyrics (`lyrics.*`)

#### `lyrics.get`

Returns lyrics with timings for the current item or a given track.

Sonolith searches its lyrics sources and returns the best result: word-synced over line-synced over unsynced. The lookup can take several seconds. Episodes have no lyrics (`notFound`). For the current item, `lyrics.changed` reports later improvements.

| Scope | Session | Rate class |
|---|---|---|
| `lyrics:read` | required | `network` |

**Params**

| Name | Type | Required | Description |
|---|---|---|---|
| `trackId` | string | no | The track's id. Default: the current item. |

**Result**

[LyricsResult](#lyricsresult).

**Errors**

- `NotFound` (-32008): no track with this id
- `Unavailable` (-32010): `nothingPlaying` when `trackId` is omitted
- `PermissionDenied` (-32003): the app lacks `lyrics:read`
- `SessionRequired` (-32012)
- the [common errors](#112-common-errors)

**Example**

Request:

```json
{"jsonrpc":"2.0","id":47,"method":"lyrics.get","params":{}}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 47,
  "result": {
    "trackId": "Xk3vT9pQm2A",
    "status": "found",
    "lyrics": {
      "trackId": "Xk3vT9pQm2A",
      "tier": "word",
      "provider": "lrclib",
      "providerName": "LRCLIB",
      "attribution": null,
      "lines": [
        {
          "startMs": 12400,
          "endMs": 15900,
          "text": "Lights on the water",
          "words": [
            {
              "startMs": 12400,
              "endMs": 12900,
              "text": "Lights "
            },
            {
              "startMs": 12900,
              "endMs": 13300,
              "text": "on "
            },
            {
              "startMs": 13300,
              "endMs": 13600,
              "text": "the "
            },
            {
              "startMs": 13600,
              "endMs": 15900,
              "text": "water"
            }
          ],
          "background": [
            {
              "startMs": 15000,
              "endMs": 15900,
              "text": "(water)"
            }
          ]
        },
        {
          "startMs": 16100,
          "endMs": null,
          "text": "Nobody calls it home",
          "words": [
            {
              "startMs": 16100,
              "endMs": 16600,
              "text": "Nobody "
            },
            {
              "startMs": 16600,
              "endMs": 17000,
              "text": "calls "
            },
            {
              "startMs": 17000,
              "endMs": 17300,
              "text": "it "
            },
            {
              "startMs": 17300,
              "endMs": 18800,
              "text": "home"
            }
          ],
          "background": []
        }
      ]
    }
  }
}
```
<!-- END GENERATED: methods -->

---

## 16. Event reference

<!-- BEGIN GENERATED: events -->
#### `player.stateChanged`

The player state changed (anything but the position moving on).

Sent when any `PlayerState` field changes, except `positionMs` and `positionAt` advancing during playback. A seek sends it. Bursts are coalesced to at most 10 per second; the last state always arrives.

| Topic | Scope |
|---|---|
| `player.state` | `player:read` |

**Params**: [PlayerState](#playerstate).

```json
{
  "jsonrpc": "2.0",
  "method": "player.stateChanged",
  "params": {
    "status": "paused",
    "item": {
      "type": "track",
      "id": "Xk3vT9pQm2A",
      "title": "Glass Harbor",
      "artists": [
        {
          "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
          "name": "Northern Static"
        }
      ],
      "album": {
        "id": "MPREb_4pL8gzRtw9a",
        "title": "Low Tide Radio"
      },
      "durationMs": 214000,
      "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
      "explicit": false,
      "video": false,
      "rating": "like"
    },
    "positionMs": 61250,
    "positionAt": 1793022000000,
    "durationMs": 214000,
    "volume": 70,
    "muted": false,
    "shuffle": false,
    "repeat": "off",
    "rate": 1,
    "episodeRate": 1.25,
    "canGoNext": true,
    "canGoPrevious": true,
    "queueIndex": 3,
    "queueLength": 25,
    "autoplay": true
  }
}
```

#### `player.trackChanged`

A different item became current (or none).

| Topic | Scope |
|---|---|
| `player.track` | `player:read` |

**Params**

| Field | Type | Description |
|---|---|---|
| `item` | [MediaItem](#mediaitem) \| null | The new current item, or null. |

```json
{
  "jsonrpc": "2.0",
  "method": "player.trackChanged",
  "params": {
    "item": {
      "type": "track",
      "id": "Rb7nW2kLq9E",
      "title": "Paper Satellites",
      "artists": [
        {
          "id": "UCq7kZ3mX9vYbL2nT5cR8wQA",
          "name": "Northern Static"
        }
      ],
      "album": {
        "id": "MPREb_4pL8gzRtw9a",
        "title": "Low Tide Radio"
      },
      "durationMs": 187000,
      "thumbnailUrl": "https://lh3.googleusercontent.com/example-artwork=w544-h544",
      "explicit": false,
      "video": false,
      "rating": "none"
    }
  }
}
```

#### `player.position`

The playback position, at the subscribed rate while playing.

Sent `positionHz` times per second while playing, and once on pause, seek and item change. Not sent while paused or stopped. Between events, extrapolate: `positionMs + (now - positionAt) * rate`.

| Topic | Scope |
|---|---|
| `player.position` | `player:read` |

**Params**: [PositionEvent](#positionevent).

```json
{
  "jsonrpc": "2.0",
  "method": "player.position",
  "params": {
    "positionMs": 61750,
    "positionAt": 1793022000500,
    "durationMs": 214000,
    "rate": 1,
    "status": "playing"
  }
}
```

#### `player.volumeChanged`

The volume or mute changed.

Bursts (for example, dragging the volume slider) are coalesced to at most 10 per second.

| Topic | Scope |
|---|---|
| `player.volume` | `player:read` |

**Params**

| Field | Type | Description |
|---|---|---|
| `volume` | [Volume](#volume) | The volume from 0 (silent) to 100 (full). |
| `muted` | boolean |  |

```json
{"jsonrpc":"2.0","method":"player.volumeChanged","params":{"volume":55,"muted":false}}
```

#### `queue.changed`

The queue's entries or current index changed.

Carries the summary only; call `queue.get` for the entries. Bursts are coalesced; `revision` tells whether a copy is current.

| Topic | Scope |
|---|---|
| `queue` | `queue:read` |

**Params**: all fields of [QueueSummary](#queuesummary), plus:

| Field | Type | Description |
|---|---|---|
| `reason` | [QueueChangeReason](#queuechangereason) | Why the queue changed. |

```json
{
  "jsonrpc": "2.0",
  "method": "queue.changed",
  "params": {
    "revision": 58,
    "currentIndex": 4,
    "length": 25,
    "autoplay": true,
    "reason": "advanced"
  }
}
```

#### `lyrics.changed`

Lyrics for the current item were found, improved, or cleared.

Sent when the current item changes (`status` `notFound` with `lyrics` null until lyrics are found), when lyrics are found, and when a better tier replaces them. The snapshot on subscribe carries what Sonolith has now.

| Topic | Scope |
|---|---|
| `lyrics` | `lyrics:read` |

**Params**: [LyricsResult](#lyricsresult).

```json
{
  "jsonrpc": "2.0",
  "method": "lyrics.changed",
  "params": {
    "trackId": "Xk3vT9pQm2A",
    "status": "found",
    "lyrics": {
      "trackId": "Xk3vT9pQm2A",
      "tier": "word",
      "provider": "lrclib",
      "providerName": "LRCLIB",
      "attribution": null,
      "lines": [
        {
          "startMs": 12400,
          "endMs": 15900,
          "text": "Lights on the water",
          "words": [
            {
              "startMs": 12400,
              "endMs": 12900,
              "text": "Lights "
            },
            {
              "startMs": 12900,
              "endMs": 13300,
              "text": "on "
            },
            {
              "startMs": 13300,
              "endMs": 13600,
              "text": "the "
            },
            {
              "startMs": 13600,
              "endMs": 15900,
              "text": "water"
            }
          ],
          "background": [
            {
              "startMs": 15000,
              "endMs": 15900,
              "text": "(water)"
            }
          ]
        },
        {
          "startMs": 16100,
          "endMs": null,
          "text": "Nobody calls it home",
          "words": [
            {
              "startMs": 16100,
              "endMs": 16600,
              "text": "Nobody "
            },
            {
              "startMs": 16600,
              "endMs": 17000,
              "text": "calls "
            },
            {
              "startMs": 17000,
              "endMs": 17300,
              "text": "it "
            },
            {
              "startMs": 17300,
              "endMs": 18800,
              "text": "home"
            }
          ],
          "background": []
        }
      ]
    }
  }
}
```

#### `lyrics.line`

The line being sung changed.

Sent while playing synced lyrics (tier `word` or `line`), when a line starts, when a break starts (`lineIndex` null), and right after a seek.

| Topic | Scope |
|---|---|
| `lyrics.line` | `lyrics:read` |

**Params**: [LyricsLineEvent](#lyricslineevent).

```json
{
  "jsonrpc": "2.0",
  "method": "lyrics.line",
  "params": {
    "trackId": "Xk3vT9pQm2A",
    "lineIndex": 0,
    "text": "Lights on the water",
    "startMs": 12400,
    "endMs": 15900,
    "positionMs": 12410
  }
}
```

#### `lyrics.word`

A word or syllable started.

Sent while playing `word`-tier lyrics, for main and background vocals. This topic is busy (often 3–8 events per second); for smooth karaoke, animate from `player.position` and the word timings instead, and use this only to correct drift.

| Topic | Scope |
|---|---|
| `lyrics.word` | `lyrics:read` |

**Params**: [LyricsWordEvent](#lyricswordevent).

```json
{
  "jsonrpc": "2.0",
  "method": "lyrics.word",
  "params": {
    "trackId": "Xk3vT9pQm2A",
    "lineIndex": 0,
    "wordIndex": 1,
    "background": false,
    "positionMs": 12905
  }
}
```

#### `account.changed`

The user signed in to or out of YouTube in Sonolith.

| Topic | Scope |
|---|---|
| `account` | none |

**Params**: [AccountState](#accountstate).

```json
{"jsonrpc":"2.0","method":"account.changed","params":{"signedIn":false}}
```

#### `registration.resolved`

A registration, scope or identity request was answered or expired.

Sent only to the connection that made the request; no subscription needed. On `approved` with a `token`, store the token before anything else, then call `session.hello`.

| Topic | Scope |
|---|---|
| always delivered | none |

**Params**: [RegistrationOutcome](#registrationoutcome).

```json
{
  "jsonrpc": "2.0",
  "method": "registration.resolved",
  "params": {
    "requestId": "req_5Jt2xQ",
    "kind": "register",
    "status": "approved",
    "token": "snl_8dmJuD9Z2UkFfCj61pn7Zn_0hI0YOf9Cuw_XU3Uerv0",
    "grantedScopes": [
      "player:read",
      "player:control"
    ],
    "retryAfterMs": null
  }
}
```

#### `session.revoked`

The app's access was revoked. Sonolith closes the connection right after.

Sent to every connection of the app; no subscription needed. The client MUST stop using Sonolith, delete the stored token, and tell the user "Disconnected from Sonolith".

| Topic | Scope |
|---|---|
| always delivered | none |

**Params**: [RevokeInfo](#revokeinfo).

```json
{"jsonrpc":"2.0","method":"session.revoked","params":{"reason":"removed"}}
```

#### `session.scopesChanged`

The app's granted scopes changed.

Sent to every connection of the app; no subscription needed. Subscriptions to topics whose scope was removed end without further notice.

| Topic | Scope |
|---|---|
| always delivered | none |

**Params**: [ScopesChanged](#scopeschanged).

```json
{
  "jsonrpc": "2.0",
  "method": "session.scopesChanged",
  "params": {
    "grantedScopes": [
      "player:read"
    ],
    "added": [],
    "removed": [
      "player:control"
    ]
  }
}
```
<!-- END GENERATED: events -->

---

## 17. Data types

Every type here is defined in [schema/](schema/) as JSON Schema (draft 2020-12). In results and events every listed
field is always present (section 13.3). Clients MUST ignore unknown fields.

<!-- BEGIN GENERATED: types -->
### Common

#### Scope

A permission an app can be granted. See "Scopes" for what each one allows and what the user sees.

One of: `"player:read"`, `"player:control"`, `"queue:read"`, `"queue:write"`, `"library:read"`, `"library:write"`, `"search"`, `"lyrics:read"`.

#### ErrorData

The `data` member of every Sonolith error. `name` and `reason` are always present; the other members appear only on the errors that define them.

| Field | Type | Present | Description |
|---|---|---|---|
| `name` | string | always | The error name, for example `PermissionDenied`. Match on this or on the numeric code. |
| `reason` | string \| null | always | A machine-readable detail, for example `cursorExpired`, or null. See "Error reasons". |
| `retryAfterMs` | integer | when relevant | RateLimited, RegistrationDenied, Unavailable: wait at least this long before trying again. |
| `scope` | [Scope](#scope) | when relevant | PermissionDenied: the scope the method or topic needs. |
| `requestId` | string | when relevant | RegistrationPending: the id of the pending request; its outcome arrives as `registration.resolved`. |
| `expiresAt` | integer (ms since epoch) | when relevant | RegistrationPending: when the pending request expires. |
| `supported` | string[] | when relevant | UnsupportedVersion: the API major versions Sonolith supports, for example `["1"]`. |
| `path` | string | when relevant | InvalidParams: a JSON Pointer to the offending parameter, for example `/items/0/id`. |

### Music and podcast items

#### ItemType

What an item is. `track` is a song or music video, `episode` a podcast episode, `podcast` a podcast show.

One of: `"track"`, `"episode"`, `"album"`, `"playlist"`, `"artist"`, `"podcast"`.

#### Ref

A reference to any item by type and YouTube id.

| Field | Type | Description |
|---|---|---|
| `type` | [ItemType](#itemtype) | What an item is. |
| `id` | string | A YouTube id. |

#### MediaRef

A reference to one playable item: a track or an episode.

| Field | Type | Description |
|---|---|---|
| `type` | "track" \| "episode" |  |
| `id` | string | A YouTube id. |

#### PlayableRef

A reference to something that can be played or queued: a track, an episode, or a whole album, playlist or podcast.

| Field | Type | Description |
|---|---|---|
| `type` | "track" \| "episode" \| "album" \| "playlist" \| "podcast" |  |
| `id` | string | A YouTube id. |

#### RateableRef

A reference to something that can be rated: a track or an episode (like, dislike), or an album, playlist or podcast (like saves it to the library).

| Field | Type | Description |
|---|---|---|
| `type` | "track" \| "episode" \| "album" \| "playlist" \| "podcast" |  |
| `id` | string | A YouTube id. |

#### Rating

The user's rating. `none` means neither liked nor disliked.

One of: `"like"`, `"dislike"`, `"none"`.

#### ArtistCredit

An artist named on an item. `id` is null when YouTube Music shows the name without a link.

| Field | Type | Description |
|---|---|---|
| `id` | string \| null |  |
| `name` | string |  |

#### AlbumCredit

The album a track belongs to. `id` is null when YouTube Music shows the title without a link.

| Field | Type | Description |
|---|---|---|
| `id` | string \| null |  |
| `title` | string |  |

#### PodcastCredit

The podcast show an episode belongs to.

| Field | Type | Description |
|---|---|---|
| `id` | string \| null |  |
| `title` | string |  |

#### Track

A song or a music video.

| Field | Type | Description |
|---|---|---|
| `type` | "track" |  |
| `id` | string | The YouTube video id. |
| `title` | string |  |
| `artists` | [ArtistCredit](#artistcredit)[] |  |
| `album` | [AlbumCredit](#albumcredit) \| null | The album, or null for music videos and singles without one. |
| `durationMs` | integer (ms) \| null | The length, or null when unknown. |
| `thumbnailUrl` | string \| null | An absolute HTTPS URL of the largest available artwork image, or null when there is none. |
| `explicit` | boolean |  |
| `video` | boolean | True for a music video (official or uploaded) rather than the audio track itself. |
| `rating` | [Rating](#rating) \| null | The user's rating, or null when unknown or when the app lacks `library:read`. |

#### Episode

A podcast episode.

| Field | Type | Description |
|---|---|---|
| `type` | "episode" |  |
| `id` | string | The YouTube video id. |
| `title` | string |  |
| `podcast` | [PodcastCredit](#podcastcredit) \| null | The show, or null when unknown. |
| `author` | string \| null | The channel that publishes the show, or null. |
| `durationMs` | integer (ms) \| null |  |
| `thumbnailUrl` | string \| null | An absolute HTTPS URL of the largest available artwork image, or null when there is none. |
| `publishedText` | string \| null | Display text such as `Mar 3, 2026` or `3 days ago`. Display only; do not parse. |
| `played` | boolean \| null | Whether the user finished it, or null when unknown or when the app lacks `library:read`. |
| `resumePositionMs` | integer (ms) \| null | Where playback resumes, or null when not started, unknown, or the app lacks `library:read`. |

#### MediaItem

One playable item: a Track or an Episode. Check `type`.

One of: [Track](#track), [Episode](#episode).

#### Album

An album, single or EP.

| Field | Type | Description |
|---|---|---|
| `type` | "album" |  |
| `id` | string | A YouTube id. |
| `title` | string |  |
| `artists` | [ArtistCredit](#artistcredit)[] |  |
| `albumType` | "album" \| "single" \| "ep" \| null | The release type, or null when unknown. |
| `year` | integer \| null | The release year, or null when unknown. |
| `thumbnailUrl` | string \| null | An absolute HTTPS URL of the largest available artwork image, or null when there is none. |
| `explicit` | boolean |  |

#### Playlist

A playlist.

| Field | Type | Description |
|---|---|---|
| `type` | "playlist" |  |
| `id` | string | A YouTube id. |
| `title` | string |  |
| `author` | string \| null | Who made it, or null. |
| `trackCount` | integer \| null | The number of items, or null when unknown. |
| `thumbnailUrl` | string \| null | An absolute HTTPS URL of the largest available artwork image, or null when there is none. |
| `editable` | boolean \| null | True when the signed-in user can change it, or null when unknown. |

#### Artist

An artist.

| Field | Type | Description |
|---|---|---|
| `type` | "artist" |  |
| `id` | string | The YouTube channel id. |
| `name` | string |  |
| `thumbnailUrl` | string \| null | An absolute HTTPS URL of the largest available artwork image, or null when there is none. |
| `subscribersText` | string \| null | Display text such as `1.2M subscribers`, or null. Display only. |

#### Podcast

A podcast show.

| Field | Type | Description |
|---|---|---|
| `type` | "podcast" |  |
| `id` | string | A YouTube id. |
| `title` | string |  |
| `author` | string \| null | The channel that publishes it, or null. |
| `thumbnailUrl` | string \| null | An absolute HTTPS URL of the largest available artwork image, or null when there is none. |

#### Item

Any item. Check `type` to tell them apart.

One of: [Track](#track), [Episode](#episode), [Album](#album), [Playlist](#playlist), [Artist](#artist), [Podcast](#podcast).

#### AlbumDetail

An album with its tracks.

All fields of [Album](#album), plus:

| Field | Type | Description |
|---|---|---|
| `description` | string \| null |  |
| `trackCount` | integer |  |
| `durationMs` | integer (ms) \| null | The total length, or null when unknown. |
| `tracks` | [Track](#track)[] | Every track, in album order. |

#### PlaylistDetail

A playlist's details (its items come in pages).

All fields of [Playlist](#playlist), plus:

| Field | Type | Description |
|---|---|---|
| `description` | string \| null |  |
| `privacy` | "public" \| "unlisted" \| "private" \| null | Who can see it, or null when unknown. |

#### ArtistSection

One shelf on an artist page.

| Field | Type | Description |
|---|---|---|
| `kind` | "songs" \| "albums" \| "singles" \| "videos" \| "playlists" \| "episodes" \| "related" \| "other" | What the shelf holds. Treat unknown values as `other`. |
| `title` | string | The shelf title as YouTube Music shows it. |
| `items` | [Item](#item)[] |  |

#### ArtistDetail

An artist page.

All fields of [Artist](#artist), plus:

| Field | Type | Description |
|---|---|---|
| `description` | string \| null |  |
| `sections` | [ArtistSection](#artistsection)[] |  |

#### PodcastDetail

A podcast show's details (its episodes come in pages).

All fields of [Podcast](#podcast), plus:

| Field | Type | Description |
|---|---|---|
| `description` | string \| null |  |

#### EpisodeDetail

An episode with its description.

All fields of [Episode](#episode), plus:

| Field | Type | Description |
|---|---|---|
| `description` | string \| null |  |

#### PlaylistEntry

One item in a playlist. `entryId` identifies this occurrence, not the track: a playlist can hold the same track twice, and the two entries have different ids. Pass it to `playlist.removeTracks` to remove exactly that entry.

| Field | Type | Description |
|---|---|---|
| `entryId` | string \| null | An opaque id of this occurrence, different from the item's own `id`, unique within the playlist, and valid while the entry stays in it. Null when YouTube Music gives the entries of this playlist no ids. Entries of a playlist the user cannot edit can have ids too; removing them fails with `notEditable`. |
| `item` | [MediaItem](#mediaitem) | One playable item: a Track or an Episode. |

#### HistoryEntry

One item in the listening history.

| Field | Type | Description |
|---|---|---|
| `item` | [MediaItem](#mediaitem) | One playable item: a Track or an Episode. |
| `sectionText` | string \| null | The group it is listed under, such as `Today` or `Last week`, or null. Display only. |

### Player and queue

#### PlaybackStatus

`playing`, `paused`, `buffering` (loading or waiting for data; playback resumes by itself) or `stopped` (nothing loaded).

One of: `"playing"`, `"paused"`, `"buffering"`, `"stopped"`.

#### RepeatMode

`off`, `all` (repeat the queue) or `one` (repeat the current item).

One of: `"off"`, `"all"`, `"one"`.

#### EpisodeRate

A playback speed for podcast episodes. Tracks always play at 1.

One of: `0.5`, `0.75`, `1`, `1.25`, `1.5`, `1.75`, `2`, `2.5`, `3`.

#### Volume

The volume from 0 (silent) to 100 (full).

#### PlayerState

Everything about the player at one moment.

| Field | Type | Description |
|---|---|---|
| `status` | [PlaybackStatus](#playbackstatus) | `playing`, `paused`, `buffering` (loading or waiting for data; playback resumes by itself) or `stopped` (nothing loaded). |
| `item` | [MediaItem](#mediaitem) \| null | The current item, or null when nothing is loaded. |
| `positionMs` | integer (ms) | The playback position when the state was taken. |
| `positionAt` | integer (ms since epoch) | When `positionMs` was measured. While `status` is `playing`, the position now is `positionMs + (now - positionAt) * rate`. |
| `durationMs` | integer (ms) \| null | The current item's length, or null when unknown or nothing is loaded. |
| `volume` | [Volume](#volume) | The volume from 0 (silent) to 100 (full). |
| `muted` | boolean |  |
| `shuffle` | boolean |  |
| `repeat` | [RepeatMode](#repeatmode) | `off`, `all` (repeat the queue) or `one` (repeat the current item). |
| `rate` | number | The speed the current item plays at: 1 for tracks, `episodeRate` for episodes. |
| `episodeRate` | [EpisodeRate](#episoderate) | A playback speed for podcast episodes. |
| `canGoNext` | boolean |  |
| `canGoPrevious` | boolean |  |
| `queueIndex` | integer \| null | The current item's index in the queue, or null when the queue is empty. |
| `queueLength` | integer |  |
| `autoplay` | boolean | Whether Sonolith adds related tracks when the queue runs out. |

#### QueueEntry

One entry in the queue. `entryId` identifies this occurrence (the queue can hold the same track twice) and stays the same when entries move.

| Field | Type | Description |
|---|---|---|
| `index` | integer |  |
| `entryId` | string |  |
| `item` | [MediaItem](#mediaitem) | One playable item: a Track or an Episode. |
| `autoplay` | boolean | True when autoplay added it (related tracks after the user's own). |

#### QueueSummary

The queue's shape without its items.

| Field | Type | Description |
|---|---|---|
| `revision` | integer | Grows by at least one whenever the entries or `currentIndex` change. Compare revisions to know whether a copy is current. |
| `currentIndex` | integer \| null | The index of the current item, or null when the queue is empty. |
| `length` | integer |  |
| `autoplay` | boolean |  |

#### QueueChangeReason

Why the queue changed. Treat unknown values as `other`.

One of: `"replaced"`, `"added"`, `"removed"`, `"moved"`, `"cleared"`, `"advanced"`, `"autoplay"`, `"other"`.

#### PositionEvent

Parameters of `player.position`.

| Field | Type | Description |
|---|---|---|
| `positionMs` | integer (ms) | A length of time or a position in milliseconds. |
| `positionAt` | integer (ms since epoch) | A point in time: milliseconds since the Unix epoch (UTC). |
| `durationMs` | integer (ms) \| null |  |
| `rate` | number |  |
| `status` | [PlaybackStatus](#playbackstatus) | `playing`, `paused`, `buffering` (loading or waiting for data; playback resumes by itself) or `stopped` (nothing loaded). |

### Lyrics

#### LyricsTier

How precisely the lyrics are timed: `word` (every word or syllable has a time), `line` (every line has a start time) or `unsynced` (plain text, no times).

One of: `"word"`, `"line"`, `"unsynced"`.

#### LyricWord

A word or syllable with its timing. Times are track positions. `text` includes its trailing space, if any, so joining the texts of a line gives the line.

| Field | Type | Description |
|---|---|---|
| `startMs` | integer (ms) | A length of time or a position in milliseconds. |
| `endMs` | integer (ms) | A length of time or a position in milliseconds. |
| `text` | string |  |

#### LyricLine

One line of lyrics. In `unsynced` lyrics, `startMs` and `endMs` are null and `words` and `background` are empty.

| Field | Type | Description |
|---|---|---|
| `startMs` | integer (ms) \| null | When the line starts, or null in unsynced lyrics. |
| `endMs` | integer (ms) \| null | When the line ends, or null when the source does not say (then it lasts until the next line starts). |
| `text` | string | The main vocal line. Can be empty for an instrumental break. |
| `words` | [LyricWord](#lyricword)[] | Word or syllable timings of `text`. Empty unless the tier is `word`. |
| `background` | [LyricWord](#lyricword)[] | Background vocals sung over this line, timed like `words`. Often empty. |

#### Lyrics

Lyrics for one track in Sonolith's normalized model, whatever the source format was.

| Field | Type | Description |
|---|---|---|
| `trackId` | string | A YouTube id. |
| `tier` | [LyricsTier](#lyricstier) | How precisely the lyrics are timed: `word` (every word or syllable has a time), `line` (every line has a start time) or `unsynced` (plain text, no times). |
| `provider` | string | A short, stable id of the lyrics source, for example `lrclib`. The set grows over time; treat unknown values as opaque. |
| `providerName` | string | The source's display name, for example `LRCLIB`. |
| `attribution` | string \| null | Credit text the source asks to show, for example `Lyrics provided by …`, or null. Show it when not null. |
| `lines` | [LyricLine](#lyricline)[] | The lines in order. Sorted by `startMs` when synced. |

#### LyricsResult

The answer to a lyrics lookup.

| Field | Type | Description |
|---|---|---|
| `trackId` | string | A YouTube id. |
| `status` | "found" \| "notFound" \| "instrumental" | `found`, `notFound`, or `instrumental` (the track has no vocals). |
| `lyrics` | [Lyrics](#lyrics) \| null | The lyrics when `status` is `found`, otherwise null. |

#### LyricsLineEvent

Parameters of `lyrics.line`.

| Field | Type | Description |
|---|---|---|
| `trackId` | string | A YouTube id. |
| `lineIndex` | integer \| null | The index into `Lyrics.lines` of the line being sung, or null before the first line and during breaks. |
| `text` | string \| null | That line's text, or null when `lineIndex` is null. |
| `startMs` | integer (ms) \| null |  |
| `endMs` | integer (ms) \| null |  |
| `positionMs` | integer (ms) | The playback position when the event was sent. |

#### LyricsWordEvent

Parameters of `lyrics.word`.

| Field | Type | Description |
|---|---|---|
| `trackId` | string | A YouTube id. |
| `lineIndex` | integer |  |
| `wordIndex` | integer | The index into the line's `words`, or into its `background` when `background` is true. |
| `background` | boolean |  |
| `positionMs` | integer (ms) | A length of time or a position in milliseconds. |

### Registration, sessions and events

#### ScopeRequest

A scope the app asks for, with the reason shown to the user.

| Field | Type | Description |
|---|---|---|
| `scope` | [Scope](#scope) | A permission an app can be granted. |
| `required` | boolean | True: the app cannot work without it and the user cannot untick it. False: the user can untick it. |
| `reason` | string | Why the app needs it, in one short sentence the user reads, for example `To show the current song in your bar`. 1–120 characters. |

#### RegistrationPending

The request is waiting for the user. Its outcome arrives as `registration.resolved` with the same `requestId`.

| Field | Type | Description |
|---|---|---|
| `status` | "pending" |  |
| `requestId` | string |  |
| `expiresAt` | integer (ms since epoch) | A point in time: milliseconds since the Unix epoch (UTC). |
| `identity` | [AppIdentity](#appidentity) | The app identity Sonolith derived for the calling process (SPEC section 6.6). |

#### RequestScopesResult

`granted` when the app already has every requested scope (nothing is shown to the user), otherwise `pending`.

| Field | Type | Description |
|---|---|---|
| `status` | "pending" \| "granted" |  |
| `requestId` | string \| null | Set when `status` is `pending`, otherwise null. |
| `expiresAt` | integer (ms since epoch) \| null | Set when `status` is `pending`, otherwise null. |
| `grantedScopes` | [Scope](#scope)[] | The scopes the app has now. |

#### RegistrationOutcome

Parameters of `registration.resolved`.

| Field | Type | Description |
|---|---|---|
| `requestId` | string |  |
| `kind` | "register" \| "scopes" \| "identity" | `register` (from `app.register`), `scopes` (from `app.requestScopes`) or `identity` (from `session.hello` after the app's executable changed). |
| `status` | "approved" \| "denied" \| "blocked" \| "expired" | `approved`, `denied` (the user said no), `blocked` (the user said no and blocked the app) or `expired` (nobody answered in time). |
| `token` | string \| null | The new client token when `kind` is `register` and `status` is `approved`, otherwise null. Sent only this once. |
| `grantedScopes` | [Scope](#scope)[] \| null | The app's scopes after an approval, otherwise null. |
| `retryAfterMs` | integer \| null | When `status` is `denied` or `expired`: how long until the app may ask again. Otherwise null. |

#### AppIdentity

Who the calling process is, as Sonolith derives it from the operating system (SPEC section 6.6). A token is bound to `key`.

| Field | Type | Description |
|---|---|---|
| `kind` | "executable" \| "interpreter" \| "appimage" \| "flatpak" | `executable` (a native program), `interpreter` (a script run by an interpreter), `appimage` or `flatpak`. |
| `key` | string | The normalized identity Sonolith compares, for example `interp:python3:/home/alex/bin/bar.py`. Version segments are replaced by `*`; lower case on Windows. |
| `executable` | string | The verified executable path as the operating system reports it. |
| `interpreter` | string \| null | The interpreter family, for example `python3` or `node`, when `kind` is `interpreter`; otherwise null. |
| `script` | string \| null | The absolute script path from the command line, or `module:<name>` for `python -m`, when `kind` is `interpreter` and there is one; otherwise null. Taken from the command line, not verified. |
| `appImage` | string \| null | The AppImage file's path when `kind` is `appimage`; otherwise null. |
| `flatpakId` | string \| null | The Flatpak app id when `kind` is `flatpak`; otherwise null. |

#### HelloResult

The authenticated session.

| Field | Type | Description |
|---|---|---|
| `apiVersion` | string | The full API version Sonolith implements, as semantic version `MAJOR.MINOR.PATCH`. |
| `appVersion` | string | Sonolith's own version. Informational; check `apiVersion` for compatibility. |
| `appId` | string | A stable reverse-DNS app id: lowercase, at least three dot-separated labels, at most 128 characters, for example `com.example.mybar`. |
| `grantedScopes` | [Scope](#scope)[] |  |
| `signedIn` | boolean | Whether the user is signed in to a YouTube account in Sonolith. |
| `identity` | [AppIdentity](#appidentity) | The app identity Sonolith derived for the calling process (SPEC section 6.6). |

#### SessionInfo

The calling app's session.

| Field | Type | Description |
|---|---|---|
| `appId` | string | A stable reverse-DNS app id: lowercase, at least three dot-separated labels, at most 128 characters, for example `com.example.mybar`. |
| `grantedScopes` | [Scope](#scope)[] |  |
| `signedIn` | boolean |  |
| `identity` | [AppIdentity](#appidentity) | The app identity Sonolith derived for the calling process (SPEC section 6.6). |

#### ServerInfo

What this Sonolith offers.

| Field | Type | Description |
|---|---|---|
| `apiVersion` | string | The full API version Sonolith implements, as semantic version `MAJOR.MINOR.PATCH`. |
| `appVersion` | string |  |
| `platform` | "linux" \| "windows" |  |
| `methods` | string[] | Every method this Sonolith supports. |
| `topics` | [Topic](#topic)[] | Every event topic this Sonolith supports. |
| `session` | [SessionInfo](#sessioninfo) \| null | The calling app's session, or null before `session.hello`. |

#### Topic

An event topic to subscribe to.

One of: `"player.state"`, `"player.track"`, `"player.position"`, `"player.volume"`, `"queue"`, `"lyrics"`, `"lyrics.line"`, `"lyrics.word"`, `"account"`.

#### SubscribeResult

The connection's subscriptions after the call.

| Field | Type | Description |
|---|---|---|
| `topics` | [Topic](#topic)[] |  |
| `positionHz` | integer (1–4) | How many `player.position` events per second this connection gets while playing. |

#### RevokeInfo

Parameters of `session.revoked`.

| Field | Type | Description |
|---|---|---|
| `reason` | "removed" \| "blocked" \| "unregistered" \| "replaced" | `removed` (the user removed the app in Sonolith), `blocked` (the user blocked it), `unregistered` (the app unregistered itself on another connection) or `replaced` (the app registered again and got a new token). Treat unknown values as `removed`. |

#### ScopesChanged

Parameters of `session.scopesChanged`.

| Field | Type | Description |
|---|---|---|
| `grantedScopes` | [Scope](#scope)[] |  |
| `added` | [Scope](#scope)[] |  |
| `removed` | [Scope](#scope)[] |  |

#### AccountState

Parameters of `account.changed`.

| Field | Type | Description |
|---|---|---|
| `signedIn` | boolean |  |

### Simple types

| Type | Meaning |
|---|---|
| ItemId | A YouTube id. Opaque: never parse it or build it from parts. |
| DurationMs | A length of time or a position in milliseconds. |
| TimestampMs | A point in time: milliseconds since the Unix epoch (UTC). |
| Cursor | An opaque pagination cursor. Pass it back unchanged to get the next page. Never build or parse it. |
| NextCursor | The cursor for the next page, or null when this is the last page. |
| Limit | The maximum number of items in one page (1–100). A page can hold fewer items even when more exist. |
| ThumbnailUrl | An absolute HTTPS URL of the largest available artwork image, or null when there is none. |
| AppId | A stable reverse-DNS app id: lowercase, at least three dot-separated labels, at most 128 characters, for example `com.example.mybar`. The `dev.sonolith.` prefix is reserved. |
| ApiVersionRequest | The API version the client was written for, as `MAJOR.MINOR`, for example `1.0`. |
| ApiVersion | The full API version Sonolith implements, as semantic version `MAJOR.MINOR.PATCH`. |
| Token | A client token: `snl_` followed by 43 base64url characters (256 random bits). A secret: store it like a password. |
| Icon | A square PNG icon as a data URI (`data:image/png;base64,…`), at least 64×64 px (256×256 recommended), at most 65536 characters. Remote URLs are not accepted. |
| Empty | An empty object: the method succeeded and has nothing to return. |
<!-- END GENERATED: types -->

---

## 18. Integration checklist

Tick every item before you ship.

1. **Connect:** read `discovery.json` and connect to its `path` (Linux MAY fall back to
   `$XDG_RUNTIME_DIR/sonolith/api.sock`); on Windows, use only the pipe name from `discovery.json` and check the
   server process id when you can.
2. **Frame correctly:** one JSON message per line, UTF-8, at most 1 MiB; match responses by `id`; ignore unknown
   fields and unknown notifications.
3. **Register only on a user action:** a "Connect to Sonolith" button calls `app.register` with a stable `appId`, a
   clear `name`, `description` and `publisher`, and a plain-language `reason` per scope. Ask only for scopes you use;
   mark `required` only those the app cannot work without.
4. **Handle pending:** keep the connection open, tell the user to approve in Sonolith, and handle every
   `registration.resolved` status: `approved`, `denied` (respect `retryAfterMs`), `blocked`, `expired`.
5. **Store the token securely:** secret store first, a user-only file as fallback; never log or show it.
6. **Keep a stable identity:** install the program or script at a fixed path; run scripts as files, not inline
   code (section 6.6).
7. **Say hello on every connection:** `session.hello` first, with `apiVersion`; handle `Unauthorized`,
   `NotRegistered`, `Blocked`, `RegistrationPending` (`identityChanged`) and `UnsupportedVersion`.
8. **Respect scopes:** use only `grantedScopes`; hide features that need other scopes; handle
   `session.scopesChanged` and `PermissionDenied`.
9. **Handle revocation:** on `session.revoked`, `Unauthorized` or `NotRegistered`, stop, delete the token, and show
   "Disconnected from Sonolith".
10. **Never re-register automatically:** only after the user asks.
11. **Offer "Disconnect from Sonolith":** a visible action that calls `app.unregister` and deletes the token, even
    when Sonolith is not available.
12. **Reconnect with backoff:** 1 s doubling to 60 s with jitter; never start Sonolith more than once per user action;
    subscribe again after reconnecting.
13. **Use events, not polling:** subscribe to topics; use `player.position` with extrapolation instead of frequent
    `player.getState`.
14. **Respect rate limits:** on `RateLimited`, wait `data.retryAfterMs`; never retry in a tight loop.
15. **Handle the common errors:** `Unavailable`, `Timeout`, `NotSignedIn`, `NotFound`, `InvalidParams`
    (`cursorExpired`: restart paging).
16. **Test without Sonolith:** with Sonolith not running, with the API turned off, and with Sonolith quitting while
    connected; the app must stay usable and retry quietly.
17. **Test the user paths:** deny, deny and block, let a request expire, untick an optional scope, remove the app in
    Sonolith while connected, and disconnect from the app.

---

## 19. Glossary

| Term | Meaning |
|---|---|
| App, client | A program that connects to Sonolith's API. |
| `appId` | The app's stable reverse-DNS id, for example `com.example.mybar`. |
| Block | The user's choice to refuse an app silently until unblocked in Settings → Connected apps. |
| Connection | One open socket or pipe connection. An app can have several. |
| Consent screen | Sonolith's screen where the user allows or denies a registration, a scope request or an identity change. |
| Cooldown | The time after a denial or expiry during which new requests are refused without asking the user. |
| Current item | The track or episode the player has loaded, playing or paused. |
| Cursor | An opaque string that continues a paged list. |
| Entry | One occurrence of an item in the queue or a playlist, identified by `entryId`. |
| Event | A notification from Sonolith: a JSON-RPC message without `id`. |
| App identity | Which program is calling: an executable, an interpreter family and script, an AppImage or a Flatpak, normalized so that updates keep it (section 6.6). |
| Executable path | The full path of the program that opened the connection, as the operating system reports it. |
| Item | A track, episode, album, playlist, artist or podcast. |
| Revision | A number that grows whenever the queue changes. |
| Registration | Asking the user to let an app connect, with `app.register`. |
| Revoke | Ending an app's access from Sonolith: the user removes or blocks it. |
| Scope | A permission, for example `player:read`. |
| Sensitive scope | A scope that changes the user's YouTube account (`library:write`), marked on the consent screen. |
| Session | An authenticated connection, after `session.hello`. |
| Snapshot | The event with the current state that Sonolith sends right after subscribing to a topic. |
| Tier | How precisely lyrics are timed: `word`, `line` or `unsynced`. |
| Token | The client token: the secret an app gets on approval and sends in `session.hello`. |
| Topic | A stream of events a connection can subscribe to, for example `player.position`. |
| Unregister | The app removing itself, with `app.unregister`. |
