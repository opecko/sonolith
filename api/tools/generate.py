#!/usr/bin/env python3
"""Generates the Sonolith API reference from one definition.

The JSON Schemas in api/schema/ define the data types; this file defines the methods, events, errors and scopes.
From both it writes api/openrpc.json, the generated blocks of api/SPEC.md and api/llms.txt (between
`<!-- BEGIN GENERATED: x -->` and `<!-- END GENERATED: x -->`), and the frontend's types (src/localApi/schema.gen.ts).

    python3 api/tools/generate.py           # regenerate
    python3 api/tools/generate.py --check   # fail if anything is stale; validate every example (needs `jsonschema`)

Edit the schemas or the tables below, never the generated output.
"""

import json
import re
import sys
from pathlib import Path

API = Path(__file__).resolve().parent.parent
SCHEMA_DIR = API / "schema"
BASE_URI = "https://raw.githubusercontent.com/opecko/sonolith/master/api/"
API_VERSION = "1.0.0"
SCHEMA_FILES = ["common", "media", "player", "lyrics", "session", "discovery"]


def ref(file, name):
    return {"$ref": f"schema/{file}.schema.json#/$defs/{name}"}


def nullable(schema):
    return {"oneOf": [schema, {"type": "null"}]}


def array(items, **extra):
    return {"type": "array", "items": items, **extra}


def obj(**props):
    """An inline result object; every property is (schema, description) and always present."""
    return {
        "type": "object",
        "required": list(props),
        "properties": {k: {**s, "description": d} if d else s for k, (s, d) in props.items()},
    }


def P(name, schema, required, description):
    return {"name": name, "schema": schema, "required": required, "description": description}


CURSOR = P("cursor", ref("common", "Cursor"), False, "The `nextCursor` of the previous page. Omit for the first page.")
LIMIT = P("limit", ref("common", "Limit"), False, "The maximum number of items. Default 50.")
NEXT = (ref("common", "NextCursor"), "")
EMPTY = ref("common", "Empty")

# ---------------------------------------------------------------- example data

THUMB = "https://lh3.googleusercontent.com/example-artwork=w544-h544"
ARTIST = {"id": "UCq7kZ3mX9vYbL2nT5cR8wQA", "name": "Northern Static"}
TRACK = {
    "type": "track", "id": "Xk3vT9pQm2A", "title": "Glass Harbor", "artists": [ARTIST],
    "album": {"id": "MPREb_4pL8gzRtw9a", "title": "Low Tide Radio"}, "durationMs": 214000,
    "thumbnailUrl": THUMB, "explicit": False, "video": False, "rating": "like",
}
TRACK2 = {
    "type": "track", "id": "Rb7nW2kLq9E", "title": "Paper Satellites", "artists": [ARTIST],
    "album": {"id": "MPREb_4pL8gzRtw9a", "title": "Low Tide Radio"}, "durationMs": 187000,
    "thumbnailUrl": THUMB, "explicit": False, "video": False, "rating": "none",
}
EPISODE = {
    "type": "episode", "id": "Lm8Qw2Xc7Vb", "title": "Episode 42: Signals in the Noise",
    "podcast": {"id": "PLp4dC8sT2mVx7Kq9wZ3nB5yR1gF6hJ0aE", "title": "The Long Signal"},
    "author": "Long Signal Media", "durationMs": 3412000, "thumbnailUrl": THUMB,
    "publishedText": "Mar 3, 2026", "played": False, "resumePositionMs": 1260000,
}
ALBUM = {
    "type": "album", "id": "MPREb_4pL8gzRtw9a", "title": "Low Tide Radio", "artists": [ARTIST],
    "albumType": "album", "year": 2025, "thumbnailUrl": THUMB, "explicit": False,
}
PLAYLIST = {
    "type": "playlist", "id": "PLx9KmQ2vT7bN4cR8wZ3yL5aD1fG6hJ0eS", "title": "Late Night Drive",
    "author": "You", "trackCount": 38, "thumbnailUrl": THUMB, "editable": True,
}
ARTIST_ITEM = {"type": "artist", "id": ARTIST["id"], "name": "Northern Static", "thumbnailUrl": THUMB,
               "subscribersText": "182K subscribers"}
PODCAST = {"type": "podcast", "id": "PLp4dC8sT2mVx7Kq9wZ3nB5yR1gF6hJ0aE", "title": "The Long Signal",
           "author": "Long Signal Media", "thumbnailUrl": THUMB}
NOW = 1793022000000
TOKEN = "snl_8dmJuD9Z2UkFfCj61pn7Zn_0hI0YOf9Cuw_XU3Uerv0"
QUEUE_SUMMARY = {"revision": 57, "currentIndex": 3, "length": 25, "autoplay": True}
# queue.add / queue.playNext: what the per-call and queue limits did.
TRUNCATED = ({"type": "boolean"}, "True when the limits left items out (1000 entries per call, 5000 in the queue).")
PLAY_TRUNCATED = ({"type": "boolean"}, "True when the album, playlist or podcast has more than `limit` items, so the queue got only the first `limit`.")
PLAY_LIMIT = ({"type": "integer", "minimum": 0, "maximum": 500}, "The most items one album, playlist or podcast puts in the queue: 500.")
QUEUE_LIMIT = ({"type": "integer", "minimum": 0, "maximum": 1000}, "How many entries this call could add: 1000, or fewer when the queue is close to 5000.")
PLAYER_STATE = {
    "status": "playing", "item": TRACK, "positionMs": 61250, "positionAt": NOW, "durationMs": 214000,
    "volume": 70, "muted": False, "shuffle": False, "repeat": "off", "rate": 1, "episodeRate": 1.25,
    "canGoNext": True, "canGoPrevious": True, "queueIndex": 3, "queueLength": 25, "autoplay": True,
}
LYRICS = {
    "trackId": TRACK["id"], "tier": "word", "provider": "lrclib", "providerName": "LRCLIB", "attribution": None,
    "lines": [
        {"startMs": 12400, "endMs": 15900, "text": "Lights on the water",
         "words": [{"startMs": 12400, "endMs": 12900, "text": "Lights "}, {"startMs": 12900, "endMs": 13300, "text": "on "},
                   {"startMs": 13300, "endMs": 13600, "text": "the "}, {"startMs": 13600, "endMs": 15900, "text": "water"}],
         "background": [{"startMs": 15000, "endMs": 15900, "text": "(water)"}]},
        {"startMs": 16100, "endMs": None, "text": "Nobody calls it home",
         "words": [{"startMs": 16100, "endMs": 16600, "text": "Nobody "}, {"startMs": 16600, "endMs": 17000, "text": "calls "},
                   {"startMs": 17000, "endMs": 17300, "text": "it "}, {"startMs": 17300, "endMs": 18800, "text": "home"}],
         "background": []},
    ],
}
IDENTITY = {"kind": "executable", "key": "exe:/usr/bin/mybar", "executable": "/usr/bin/mybar", "interpreter": None,
            "script": None, "appImage": None, "flatpakId": None}
IDENTITY_CASES = json.loads((API / "tests" / "identity-cases.json").read_text())["cases"]
SCOPES_BAR = [
    {"scope": "player:read", "required": True, "reason": "To show the current song in your bar"},
    {"scope": "player:control", "required": False, "reason": "To play, pause and skip from your bar"},
]

# ---------------------------------------------------------------- scopes, rate classes, errors

SCOPES = [
    ("player:read", "See what's playing", False, "The current item, playback state, position, volume, shuffle and repeat."),
    ("player:control", "Control playback", False, "Play, pause, skip, seek, volume, shuffle, repeat, episode speed, and starting a track, album, playlist or episode (which replaces the queue)."),
    ("queue:read", "See your queue", False, "The queue and autoplay."),
    ("queue:write", "Change your queue", False, "Add, move and remove queue entries, clear the queue, turn autoplay on or off."),
    ("library:read", "Access your library", False, "Playlists, liked songs, albums, artists, podcasts, episodes for later, history, and your ratings in returned items."),
    ("library:write", "Change your library", True, "Create, rename and delete playlists, add and remove playlist items, like and dislike, save albums, playlists and podcasts."),
    ("search", "Search YouTube Music", False, "Search, suggestions, and album, artist, podcast, episode and public playlist pages."),
    ("lyrics:read", "Show lyrics", False, "Lyrics with timings for the current or any track, and live line and word events."),
]

RATE_CLASSES = [
    ("local", "50 per second, bursts of 100", "Reads of Sonolith's own state."),
    ("control", "10 per second, bursts of 20", "Player and queue commands."),
    ("network", "2 per second, bursts of 10", "Reads that may reach YouTube or a lyrics source."),
    ("account", "1 every 2 seconds, bursts of 5 (30 per minute)", "Changes to the user's YouTube account."),
    ("auth", "1 per second, bursts of 5, per connection", "Registration and authentication."),
]

# (code, name, meaning, what the client does)
ERRORS = [
    (-32700, "ParseError", "The line is not valid UTF-8 JSON.", "Fix the client. The connection stays open."),
    (-32600, "InvalidRequest", "Not a valid JSON-RPC 2.0 request object, a batch, a message over the size limit (Sonolith then closes the connection), or a call not allowed in the connection's state.", "Fix the client. See `data.reason`."),
    (-32601, "MethodNotFound", "No such method in this Sonolith.", "Check `app.info` `methods`; the method may be newer than this Sonolith."),
    (-32602, "InvalidParams", "Missing, unknown or invalid parameters, or an expired cursor.", "Fix the call. `data.path` points at the parameter; `data.reason` is `cursorExpired` when a cursor is too old."),
    (-32603, "InternalError", "Sonolith failed unexpectedly.", "Retry later; report it if it repeats."),
    (-32001, "NotRegistered", "The `appId` is not registered (never registered, unregistered, or removed by the user).", "Delete the stored token. Show \"Disconnected from Sonolith\". Register again only after a user action."),
    (-32002, "Unauthorized", "The token is wrong or has been revoked.", "Delete the stored token. Show \"Disconnected from Sonolith\". Register again only after a user action."),
    (-32003, "PermissionDenied", "The app lacks the scope in `data.scope`.", "Do not retry. Hide the feature, or ask for the scope with `app.requestScopes` after a user action."),
    (-32004, "RegistrationPending", "A request is already waiting for the user, or the app identity changed and the user must approve it again.", "Wait for `registration.resolved` with `data.requestId` on the connection that made the request."),
    (-32005, "RegistrationDenied", "The user denied a recent request; asking again is on hold.", "Do not ask again before `data.retryAfterMs`, and then only after a user action."),
    (-32006, "Blocked", "The user blocked this app.", "Stop. Tell the user the app can be unblocked in Sonolith's Settings → Connected apps."),
    (-32007, "NotSignedIn", "The method needs a YouTube account and the user is signed out.", "Tell the user to sign in in Sonolith; subscribe to `account` to know when they do."),
    (-32008, "NotFound", "The item does not exist or is not visible to this app.", "Do not retry with the same id."),
    (-32009, "RateLimited", "The app exceeded its rate limit or its in-flight request limit.", "Wait `data.retryAfterMs`, then retry."),
    (-32010, "Unavailable", "The action is not possible right now (for example, nothing is playing, or Sonolith is still starting).", "See `data.reason`; retry after `data.retryAfterMs` when present."),
    (-32011, "Timeout", "YouTube, a lyrics source or Sonolith did not answer in time.", "Retry later with backoff."),
    (-32012, "SessionRequired", "The method needs an authenticated session.", "Call `session.hello` first."),
    (-32013, "UnsupportedVersion", "Sonolith does not support the requested API major version.", "Tell the user to update Sonolith or the app. `data.supported` lists the supported majors."),
]
ERROR_CODES = {name: code for code, name, _, _ in ERRORS}

# Errors every method can return; methods list only their own on top.
COMMON_ERRORS = ["InvalidRequest", "InvalidParams", "InternalError", "RateLimited", "Unavailable", "Timeout"]

# (reason, error, meaning)
REASONS = [
    ("messageTooLarge", "InvalidRequest", "The message was over 1 MiB. Sonolith closes the connection."),
    ("batchNotSupported", "InvalidRequest", "The message was a JSON array (a batch)."),
    ("resultTooLarge", "InternalError", "The answer would be over 1 MiB, Sonolith's own message limit. Ask for less, for example a smaller `limit`."),
    ("alreadyAuthenticated", "InvalidRequest", "`session.hello` or `app.register` on a connection that already has a session."),
    ("cursorExpired", "InvalidParams", "The cursor is too old or the list changed; start again from the first page."),
    ("unknownParam", "InvalidParams", "A parameter this Sonolith does not know (it may be newer than this Sonolith)."),
    ("identityChanged", "RegistrationPending", "The app identity changed (section 6.6); the user is asked to approve it again."),
    ("starting", "Unavailable", "Sonolith is still starting up."),
    ("nothingPlaying", "Unavailable", "The method needs a current item and there is none."),
    ("notEditable", "Unavailable", "The playlist cannot be changed by the user (for example, it belongs to someone else)."),
    ("notPlayable", "Unavailable", "YouTube does not allow playing this item."),
    ("peerUnverified", "Unavailable", "Sonolith could not identify the calling process, so it cannot register it."),
    ("tooManyPending", "RateLimited", "Too many registration requests are already waiting for the user."),
    ("tooManyInFlight", "RateLimited", "The connection has 16 requests in flight already."),
    ("tooManyConnections", "RateLimited", "The app has 8 open connections already."),
]

# ---------------------------------------------------------------- methods


def M(name, summary, *, scope=None, session=True, rate, params=(), result, result_desc="", errors=(),
      example_params=None, example_result=None, description="", params_extra=None):
    return dict(name=name, summary=summary, scope=scope, session=session, rate=rate, params=list(params),
                result=result, result_desc=result_desc, errors=list(errors), example_params=example_params,
                example_result=example_result, description=description, params_extra=params_extra or {})


PAGE_PARAMS = [CURSOR, LIMIT]


def paged(items_schema, desc):
    return obj(items=(array(items_schema), desc), nextCursor=NEXT)


METHODS = [
    # ---------------------------------------------------------------- app, session
    M("app.info", "Describes this Sonolith: API version, supported methods and topics, and the caller's session.",
      session=False, rate="local", result=ref("session", "ServerInfo"),
      description="Works before `session.hello`, so a client can check the API version first. `session` is null until the connection is authenticated.",
      example_params=None,
      example_result={"apiVersion": "1.0.0", "appVersion": "2.4.0", "platform": "linux",
                      "methods": ["app.info", "app.register", "session.hello", "player.getState"],
                      "topics": ["player.state", "player.track", "player.position"], "session": None}),
    M("app.register", "Asks the user to let this app connect. Returns `pending` at once; the outcome arrives as `registration.resolved`.",
      session=False, rate="auth",
      description=(
          "Sonolith identifies the calling process through the operating system, shows a system notification and a consent screen, "
          "and answers with `pending`. The client MUST keep this connection open until `registration.resolved` arrives on it: if the "
          "connection closes, Sonolith cancels the request and withdraws the consent screen. A request expires after 5 minutes.\n\n"
          "Registering an `appId` that is already registered also goes through consent. When the user approves, the old token stops "
          "working (its connections get `session.revoked` with reason `replaced`) and the new one is sent.\n\n"
          "A client MUST call this only after a user action (for example, a \"Connect to Sonolith\" button), never on its own at startup or after an error.\n\n"
          "`name`, `description`, `publisher` and each scope's `reason` are single lines of plain text: control characters (line breaks "
          "included) and invisible formatting characters (such as direction overrides or zero-width spaces) fail with `InvalidParams`."),
      params=[
          P("appId", ref("common", "AppId"), True, "The app's stable id. Use the same id in every version of the app."),
          P("name", {"type": "string", "minLength": 1, "maxLength": 48}, True, "The app's name as the user knows it. 1–48 characters."),
          P("description", {"type": "string", "minLength": 1, "maxLength": 200}, True, "What the app is, in one sentence. 1–200 characters."),
          P("publisher", {"type": "string", "minLength": 1, "maxLength": 64}, True, "Who makes the app: a person, a team or a company. 1–64 characters."),
          P("homepage", {"type": "string", "pattern": "^https://", "maxLength": 200, "format": "uri"}, False, "The app's web page. `https://` only, at most 200 characters."),
          P("icon", ref("session", "Icon"), False, "A square PNG data URI, at most 65536 characters. No remote URLs."),
          P("scopes", array(ref("session", "ScopeRequest"), minItems=1, maxItems=8), True, "The scopes the app wants, each with `required` and a `reason`. Each scope at most once."),
          P("apiVersion", ref("common", "ApiVersionRequest"), True, "The API version the client was written for, for example `1.0`."),
      ],
      result=ref("session", "RegistrationPending"),
      errors=[("Blocked", "the user blocked this app; nothing is shown to the user"),
              ("RegistrationDenied", "the user denied a recent request; `data.retryAfterMs`"),
              ("RegistrationPending", "another connection already has a request waiting for this `appId`"),
              ("UnsupportedVersion", None)],
      example_params={"appId": "com.example.mybar", "name": "My Bar", "description": "A status bar for Wayland compositors.",
                      "publisher": "Example Labs", "homepage": "https://example.com/mybar", "scopes": SCOPES_BAR, "apiVersion": "1.0"},
      example_result={"status": "pending", "requestId": "req_5Jt2xQ", "expiresAt": NOW + 300000, "identity": IDENTITY}),
    M("app.requestScopes", "Asks the user for more scopes. Shows a consent screen with only the new ones.",
      rate="auth",
      description=(
          "Scopes the app already has are ignored. When nothing new is asked, the result is `granted` and nothing is shown. "
          "Otherwise the result is `pending` and the outcome arrives as `registration.resolved` with `kind` `scopes`; on approval "
          "`session.scopesChanged` follows. The connection MUST stay open while the request is pending. Call this only after a user action."),
      params=[P("scopes", array(ref("session", "ScopeRequest"), minItems=1, maxItems=8), True, "The additional scopes, each with `required` and a `reason`.")],
      result=ref("session", "RequestScopesResult"),
      errors=[("RegistrationDenied", "the user denied a recent request; `data.retryAfterMs`"),
              ("RegistrationPending", "a request for this app is already waiting")],
      example_params={"scopes": [{"scope": "lyrics:read", "required": True, "reason": "To show the current lyric line in your bar"}]},
      example_result={"status": "pending", "requestId": "req_9Wm4Lc", "expiresAt": NOW + 300000, "grantedScopes": ["player:read", "player:control"]}),
    M("app.unregister", "Removes this app from Sonolith and invalidates its token.",
      rate="auth",
      description=(
          "Call this from the app's \"Disconnect from Sonolith\" button, then delete the stored token. Sonolith answers, shows the user "
          "\"<name> disconnected from Sonolith\", closes this connection, and sends `session.revoked` (reason `unregistered`) to the app's other connections."),
      result=EMPTY, example_params=None, example_result={}),
    M("session.hello", "Authenticates the connection with the app's token.",
      session=False, rate="auth",
      description=(
          "Send it first on every new connection. Sonolith checks the token and that the calling process has the app identity the user approved (section 6.6). "
          "Sonolith finishes `session.hello` before it reads the next message, so a client MAY send further requests right after it without waiting.\n\n"
          "If the app identity changed (for example, the app was moved), the user is asked again and the call fails with `RegistrationPending` "
          "(reason `identityChanged`). Keep the connection open, wait for `registration.resolved` (`kind` `identity`), and on approval call `session.hello` again with the same token."),
      params=[
          P("appId", ref("common", "AppId"), True, "The id the app registered with."),
          P("token", ref("session", "Token"), True, "The token from `registration.resolved`."),
          P("apiVersion", ref("common", "ApiVersionRequest"), True, "The API version the client was written for, for example `1.0`."),
      ],
      result=ref("session", "HelloResult"),
      errors=[("NotRegistered", "delete the token; re-register only after a user action"),
              ("Unauthorized", "delete the token; re-register only after a user action"),
              ("Blocked", None), ("RegistrationPending", "`identityChanged`"), ("UnsupportedVersion", None)],
      example_params={"appId": "com.example.mybar", "token": TOKEN, "apiVersion": "1.0"},
      example_result={"apiVersion": "1.0.0", "appVersion": "2.4.0", "appId": "com.example.mybar",
                      "grantedScopes": ["player:read", "player:control"], "signedIn": True, "identity": IDENTITY}),
    # ---------------------------------------------------------------- events
    M("events.subscribe", "Subscribes the connection to event topics. Sends a snapshot of each new topic right after the response.",
      rate="local",
      description=(
          "Each topic needs the scope shown in the topic table; if any topic is not allowed, the whole call fails with `PermissionDenied` and nothing changes. "
          "Subscribing to a topic the connection already has is not an error (no new snapshot is sent for it). "
          "Subscriptions belong to the connection and end with it."),
      params=[
          P("topics", array(ref("session", "Topic"), minItems=1, uniqueItems=True), True, "The topics to add."),
          P("positionHz", {"type": "integer", "minimum": 1, "maximum": 4, "default": 1}, False, "`player.position` events per second while playing, 1–4. Default 1. Applies to the whole connection."),
      ],
      result=ref("session", "SubscribeResult"),
      errors=[("PermissionDenied", "`data.scope` names the missing scope")],
      example_params={"topics": ["player.state", "player.position", "lyrics.line"], "positionHz": 2},
      example_result={"topics": ["player.state", "player.position", "lyrics.line"], "positionHz": 2}),
    M("events.unsubscribe", "Removes topics from the connection's subscriptions.",
      rate="local",
      params=[P("topics", array(ref("session", "Topic"), minItems=1, uniqueItems=True), True, "The topics to remove. Topics the connection does not have are ignored.")],
      result=ref("session", "SubscribeResult"),
      example_params={"topics": ["lyrics.line"]},
      example_result={"topics": ["player.state", "player.position"], "positionHz": 2}),
    # ---------------------------------------------------------------- player
    M("player.getState", "Returns the full player state.", scope="player:read", rate="local",
      result=ref("player", "PlayerState"), example_params=None, example_result=PLAYER_STATE),
    M("player.play", "Starts or resumes playback.", scope="player:control", rate="control", result=EMPTY,
      errors=[("Unavailable", "`nothingPlaying`: the queue is empty")], example_params=None, example_result={}),
    M("player.pause", "Pauses playback. Pausing while paused is not an error.", scope="player:control", rate="control",
      result=EMPTY, example_params=None, example_result={}),
    M("player.toggle", "Plays when paused, pauses when playing.", scope="player:control", rate="control", result=EMPTY,
      errors=[("Unavailable", "`nothingPlaying`")], example_params=None, example_result={}),
    M("player.next", "Skips to the next item in the queue.", scope="player:control", rate="control", result=EMPTY,
      description="With repeat `all` it wraps to the first item; with autoplay on, Sonolith may first add related tracks.",
      errors=[("Unavailable", "`nothingPlaying`; also when there is no next item (`canGoNext` is false)")], example_params=None, example_result={}),
    M("player.previous", "Goes back like the Previous button: restarts the current item when more than 3 seconds have played, otherwise plays the previous item.",
      scope="player:control", rate="control", result=EMPTY,
      errors=[("Unavailable", "`nothingPlaying`")], example_params=None, example_result={}),
    M("player.seek", "Seeks in the current item. Pass exactly one of `positionMs` and `offsetMs`.",
      scope="player:control", rate="control", result=EMPTY,
      params=[
          P("positionMs", ref("common", "DurationMs"), False, "The position to seek to. Clamped to the item's length."),
          P("offsetMs", {"type": "integer"}, False, "A relative jump; negative goes back. The result is clamped to the item."),
      ],
      params_extra={"oneOf": [{"required": ["positionMs"]}, {"required": ["offsetMs"]}]},
      errors=[("Unavailable", "`nothingPlaying`")], example_params={"positionMs": 90000}, example_result={}),
    M("player.setVolume", "Sets the volume, mute, or both. Pass at least one.",
      scope="player:control", rate="control", result=EMPTY,
      params=[
          P("volume", ref("player", "Volume"), False, "The volume, 0–100. Setting a volume above 0 also unmutes."),
          P("muted", {"type": "boolean"}, False, "Mute or unmute."),
      ],
      params_extra={"minProperties": 1}, example_params={"volume": 55}, example_result={}),
    M("player.setShuffle", "Turns shuffle on or off.", scope="player:control", rate="control", result=EMPTY,
      params=[P("enabled", {"type": "boolean"}, True, "")], example_params={"enabled": True}, example_result={}),
    M("player.setRepeat", "Sets the repeat mode.", scope="player:control", rate="control", result=EMPTY,
      params=[P("mode", ref("player", "RepeatMode"), True, "")], example_params={"mode": "all"}, example_result={}),
    M("player.setRate", "Sets the playback speed for podcast episodes. Tracks always play at 1.",
      scope="player:control", rate="control", result=EMPTY,
      description="The speed is a Sonolith setting: it applies to the current episode at once and to every episode after it. Setting it while a track plays is allowed and takes effect at the next episode.",
      params=[P("rate", ref("player", "EpisodeRate"), True, "One of the listed speeds.")],
      example_params={"rate": 1.5}, example_result={}),
    M("player.playItem", "Plays a track, episode, album, playlist or podcast. Replaces the queue.",
      scope="player:control", rate="control", result=obj(truncated=PLAY_TRUNCATED, limit=PLAY_LIMIT),
      description=(
          "A track or episode starts a new queue with that item; with autoplay on, Sonolith continues with related tracks. "
          "An album, playlist or podcast fills the queue with its items in order (a podcast: its episodes, newest first), at most 500; `truncated` is true when it has more. "
          "An episode resumes where the user left off unless `positionMs` is given."),
      params=[
          P("item", ref("media", "PlayableRef"), True, "What to play."),
          P("startId", ref("media", "ItemId"), False, "For an album, playlist or podcast: the id of the track or episode to start with. Default: the first."),
          P("shuffle", {"type": "boolean"}, False, "For an album, playlist or podcast: shuffle it and turn shuffle on. Default false."),
          P("positionMs", ref("common", "DurationMs"), False, "Where to start in the first item."),
      ],
      errors=[("NotFound", "the item does not exist, or it is the user's own playlist, liked songs, episodes for later or a personal mix while the app lacks `library:read` (see `playlist.get`)"), ("Unavailable", "`notPlayable`")],
      example_params={"item": {"type": "album", "id": "MPREb_4pL8gzRtw9a"}, "startId": "Rb7nW2kLq9E"}, example_result={"truncated": False, "limit": 500}),
    # ---------------------------------------------------------------- queue
    M("queue.get", "Returns the queue, one page at a time.", scope="queue:read", rate="local",
      description="A cursor is tied to the queue's `revision`. If the queue changes between pages, the next page fails with `InvalidParams` (`cursorExpired`); start again.",
      params=[P("fromIndex", {"type": "integer", "minimum": 0}, False, "Start at this index instead of 0, for example `currentIndex` to get what plays next. Ignored with `cursor`."), CURSOR, LIMIT],
      result={"allOf": [ref("player", "QueueSummary"), obj(items=(array(ref("player", "QueueEntry")), "The entries of this page, in queue order."), nextCursor=NEXT)]},
      result_desc="The QueueSummary fields, plus `items` and `nextCursor`.",
      example_params={"fromIndex": 3, "limit": 2},
      example_result={**QUEUE_SUMMARY, "items": [
          {"index": 3, "entryId": "q_118", "item": TRACK, "autoplay": False},
          {"index": 4, "entryId": "q_119", "item": TRACK2, "autoplay": True}], "nextCursor": "cXVldWU6NTc6NQ"}),
    M("queue.add", "Adds items to the end of the queue.", scope="queue:write", rate="control",
      description="An album, playlist or podcast adds all its items (at most 500). If autoplay entries are at the end, the new items go before them. One call adds at most 1000 entries and never grows the queue past 5000 entries; items beyond that are left out (and not looked up): then `truncated` is true, and `limit` says how many entries the call could add.",
      params=[P("items", array(ref("media", "PlayableRef"), minItems=1, maxItems=50), True, "What to add, in order.")],
      result=obj(added=({"type": "integer", "minimum": 0}, "How many entries were added."), truncated=TRUNCATED, limit=QUEUE_LIMIT, queue=(ref("player", "QueueSummary"), "")),
      errors=[("NotFound", "one of the items does not exist, or is the user's own playlist, liked songs, episodes for later or a personal mix while the app lacks `library:read` (see `playlist.get`); nothing is added")],
      example_params={"items": [{"type": "track", "id": "Rb7nW2kLq9E"}]},
      example_result={"added": 1, "truncated": False, "limit": 1000, "queue": {**QUEUE_SUMMARY, "revision": 58, "length": 26}}),
    M("queue.playNext", "Inserts items right after the current item.", scope="queue:write", rate="control",
      description="The same limits as `queue.add`: at most 500 items per album, playlist or podcast, 1000 entries per call, and a queue of at most 5000 entries.",
      params=[P("items", array(ref("media", "PlayableRef"), minItems=1, maxItems=50), True, "What to insert, in order.")],
      result=obj(added=({"type": "integer", "minimum": 0}, "How many entries were added."), truncated=TRUNCATED, limit=QUEUE_LIMIT, queue=(ref("player", "QueueSummary"), "")),
      errors=[("NotFound", "one of the items does not exist, or is the user's own playlist, liked songs, episodes for later or a personal mix while the app lacks `library:read` (see `playlist.get`); nothing is added")],
      example_params={"items": [{"type": "album", "id": "MPREb_4pL8gzRtw9a"}]},
      example_result={"added": 10, "truncated": False, "limit": 1000, "queue": {**QUEUE_SUMMARY, "revision": 58, "length": 35}}),
    M("queue.move", "Moves one entry to a new index.", scope="queue:write", rate="control",
      params=[P("entryId", {"type": "string"}, True, "The entry to move."),
              P("toIndex", {"type": "integer", "minimum": 0}, True, "Its index after the move. Clamped to the queue.")],
      result=obj(queue=(ref("player", "QueueSummary"), "")),
      errors=[("NotFound", "no entry with this `entryId`")],
      example_params={"entryId": "q_119", "toIndex": 4}, example_result={"queue": {**QUEUE_SUMMARY, "revision": 59}}),
    M("queue.remove", "Removes entries from the queue.", scope="queue:write", rate="control",
      description="Removing the current entry plays the next one (or stops at the end). Unknown `entryIds` are ignored.",
      params=[P("entryIds", array({"type": "string"}, minItems=1, maxItems=100, uniqueItems=True), True, "The entries to remove.")],
      result=obj(removed=({"type": "integer", "minimum": 0}, ""), queue=(ref("player", "QueueSummary"), "")),
      example_params={"entryIds": ["q_119"]}, example_result={"removed": 1, "queue": {**QUEUE_SUMMARY, "revision": 60, "length": 24}}),
    M("queue.clear", "Removes every entry except the current one. Playback continues.", scope="queue:write", rate="control",
      result=obj(queue=(ref("player", "QueueSummary"), "")), example_params=None,
      example_result={"queue": {"revision": 61, "currentIndex": 0, "length": 1, "autoplay": True}}),
    M("queue.setAutoplay", "Turns autoplay on or off.", scope="queue:write", rate="control",
      description="Turning it off removes the autoplay entries that have not played yet.",
      params=[P("enabled", {"type": "boolean"}, True, "")],
      result=obj(queue=(ref("player", "QueueSummary"), "")),
      example_params={"enabled": False}, example_result={"queue": {**QUEUE_SUMMARY, "revision": 62, "length": 12, "autoplay": False}}),
    # ---------------------------------------------------------------- library
    M("library.playlists", "Lists the playlists in the user's library.", scope="library:read", rate="network",
      params=PAGE_PARAMS, result=paged(ref("media", "Playlist"), ""), errors=[("NotSignedIn", None)],
      example_params={"limit": 1}, example_result={"items": [PLAYLIST], "nextCursor": "bGliOnBsOjE"}),
    M("library.likedSongs", "Lists the user's liked songs, newest first.", scope="library:read", rate="network",
      params=PAGE_PARAMS, result=paged(ref("media", "MediaItem"), ""), errors=[("NotSignedIn", None)],
      example_params={"limit": 1}, example_result={"items": [TRACK], "nextCursor": "bGliOmxpa2VkOjE"}),
    M("library.albums", "Lists the albums in the user's library.", scope="library:read", rate="network",
      params=PAGE_PARAMS, result=paged(ref("media", "Album"), ""), errors=[("NotSignedIn", None)],
      example_params={"limit": 1}, example_result={"items": [ALBUM], "nextCursor": None}),
    M("library.artists", "Lists the artists in the user's library.", scope="library:read", rate="network",
      params=PAGE_PARAMS, result=paged(ref("media", "Artist"), ""), errors=[("NotSignedIn", None)],
      example_params={}, example_result={"items": [ARTIST_ITEM], "nextCursor": None}),
    M("library.podcasts", "Lists the podcast shows in the user's library.", scope="library:read", rate="network",
      params=PAGE_PARAMS, result=paged(ref("media", "Podcast"), ""), errors=[("NotSignedIn", None)],
      example_params={}, example_result={"items": [PODCAST], "nextCursor": None}),
    M("library.episodesForLater", "Lists the episodes the user saved for later.", scope="library:read", rate="network",
      params=PAGE_PARAMS, result=paged(ref("media", "Episode"), ""), errors=[("NotSignedIn", None)],
      example_params={}, example_result={"items": [EPISODE], "nextCursor": None}),
    M("library.history", "Lists the user's listening history, newest first.", scope="library:read", rate="network",
      params=PAGE_PARAMS, result=paged(ref("media", "HistoryEntry"), ""), errors=[("NotSignedIn", None)],
      example_params={"limit": 2},
      example_result={"items": [{"item": TRACK, "sectionText": "Today"}, {"item": EPISODE, "sectionText": "Yesterday"}], "nextCursor": "aGlzdDoy"}),
    # ---------------------------------------------------------------- playlist
    M("playlist.get", "Returns a playlist and its items, one page at a time.", scope=["library:read", "search"], rate="network",
      description="With `library:read`, any playlist the user can see works, including private ones and liked songs. With only `search`, only other people's public and unlisted playlists work; the user's own playlists (also public ones), liked songs, episodes for later and the mixes made from the user's listening give `NotFound`. An id with YouTube's `VL` prefix (`VLPL…`) is the same playlist as without it.\n\nEvery item comes as an entry with its own `entryId`. A song that is in the playlist twice is two entries with the same `item.id` and different `entryId`s.",
      params=[P("id", ref("media", "ItemId"), True, "The playlist id."), CURSOR, LIMIT],
      result=obj(playlist=(ref("media", "PlaylistDetail"), "The playlist; repeated on every page."),
                 items=(array(ref("media", "PlaylistEntry")), ""), nextCursor=NEXT),
      errors=[("NotFound", None)],
      example_params={"id": PLAYLIST["id"], "limit": 3},
      example_result={"playlist": {**PLAYLIST, "description": "For the long way home.", "privacy": "private"},
                      "items": [{"entryId": "56B44F6D10557CC6", "item": TRACK}, {"entryId": "3A9E5D0C7B21F48A", "item": TRACK2},
                                {"entryId": "C41D8F7A60B3E952", "item": TRACK}], "nextCursor": "cGw6Mw"}),
    M("playlist.create", "Creates a playlist in the user's library.", scope="library:write", rate="account",
      params=[
          P("title", {"type": "string", "minLength": 1, "maxLength": 150}, True, "1–150 characters."),
          P("description", {"type": "string", "maxLength": 5000}, False, "At most 5000 characters."),
          P("privacy", {"type": "string", "enum": ["public", "unlisted", "private"], "default": "private"}, False, "Default `private`."),
          P("items", array(ref("media", "MediaRef"), maxItems=100), False, "Tracks or episodes to put in it, in order."),
      ],
      result=ref("media", "Playlist"), errors=[("NotSignedIn", None), ("NotFound", "one of the items does not exist; nothing is created")],
      example_params={"title": "Bar picks", "items": [{"type": "track", "id": "Xk3vT9pQm2A"}]},
      example_result={**PLAYLIST, "id": "PLr2Vw8Nq4Kd7Ls1Xc9Bz3Mf6Ht5Jy0Ga", "title": "Bar picks", "trackCount": 1}),
    M("playlist.rename", "Renames a playlist the user owns.", scope="library:write", rate="account", result=EMPTY,
      params=[P("id", ref("media", "ItemId"), True, ""), P("title", {"type": "string", "minLength": 1, "maxLength": 150}, True, "The new title, 1–150 characters.")],
      errors=[("NotSignedIn", None), ("NotFound", None), ("Unavailable", "`notEditable`")],
      example_params={"id": PLAYLIST["id"], "title": "Later Night Drive"}, example_result={}),
    M("playlist.delete", "Deletes a playlist the user owns. This cannot be undone.", scope="library:write", rate="account", result=EMPTY,
      params=[P("id", ref("media", "ItemId"), True, "")],
      errors=[("NotSignedIn", None), ("NotFound", None), ("Unavailable", "`notEditable`")],
      example_params={"id": "PLr2Vw8Nq4Kd7Ls1Xc9Bz3Mf6Ht5Jy0Ga"}, example_result={}),
    M("playlist.addTracks", "Adds tracks or episodes to the end of a playlist the user owns.", scope="library:write", rate="account",
      params=[
          P("id", ref("media", "ItemId"), True, "The playlist id."),
          P("items", array(ref("media", "MediaRef"), minItems=1, maxItems=100), True, "What to add, in order."),
          P("allowDuplicates", {"type": "boolean", "default": False}, False, "Add items the playlist already has. Default false: they are skipped."),
      ],
      result=obj(added=({"type": "integer", "minimum": 0}, ""), skipped=({"type": "integer", "minimum": 0}, "Items skipped as duplicates.")),
      errors=[("NotSignedIn", None), ("NotFound", None), ("Unavailable", "`notEditable`")],
      example_params={"id": PLAYLIST["id"], "items": [{"type": "track", "id": "Rb7nW2kLq9E"}, {"type": "track", "id": "Xk3vT9pQm2A"}]},
      example_result={"added": 1, "skipped": 1}),
    M("playlist.removeTracks", "Removes entries from a playlist the user owns.", scope="library:write", rate="account",
      description="Removes exactly the entries named by `entryIds`, nothing else: a song that is in the playlist twice loses only the copy whose `entryId` you pass. Ids the playlist does not have (already removed, or an item id instead of an `entryId`) are ignored, and `removed` counts the entries that were removed. Entry ids come from `playlist.get`; remove duplicates one `entryId` at a time or together.",
      params=[P("id", ref("media", "ItemId"), True, "The playlist id."),
              P("entryIds", array({"type": "string"}, minItems=1, maxItems=100, uniqueItems=True), True, "`entryId` values from `playlist.get`, not item ids.")],
      result=obj(removed=({"type": "integer", "minimum": 0}, "How many of the entries were removed.")),
      errors=[("NotSignedIn", None), ("NotFound", None), ("Unavailable", "`notEditable`")],
      example_params={"id": PLAYLIST["id"], "entryIds": ["56B44F6D10557CC6"]}, example_result={"removed": 1}),
    # ---------------------------------------------------------------- search, browse
    M("search.query", "Searches YouTube Music.", scope="search", rate="network",
      description="With `type` `all` the result is one page of mixed items (the best matches of each kind) plus an optional `topResult`, and `nextCursor` is always null. With any other `type` the results are paged and `topResult` is null.",
      params=[
          P("query", {"type": "string", "minLength": 1, "maxLength": 200}, True, "The search text, 1–200 characters."),
          P("type", {"type": "string", "enum": ["all", "songs", "videos", "albums", "artists", "playlists", "podcasts", "episodes"], "default": "all"}, False, "What to search for. Default `all`."),
          CURSOR, LIMIT,
      ],
      result=obj(topResult=(nullable(ref("media", "Item")), "The best match when `type` is `all`, otherwise null."),
                 items=(array(ref("media", "Item")), ""), nextCursor=NEXT),
      example_params={"query": "northern static glass harbor", "type": "songs", "limit": 1},
      example_result={"topResult": None, "items": [TRACK], "nextCursor": "c3JjaDoxOjE"}),
    M("search.suggestions", "Returns search suggestions for partial text.", scope="search", rate="network",
      params=[P("query", {"type": "string", "minLength": 1, "maxLength": 200}, True, "The text typed so far.")],
      result=obj(queries=(array({"type": "string"}), "Suggested search texts."), items=(array(ref("media", "Item")), "Suggested items.")),
      example_params={"query": "northern sta"},
      example_result={"queries": ["northern static", "northern static glass harbor"], "items": [ARTIST_ITEM]}),
    M("browse.album", "Returns an album with all its tracks.", scope="search", rate="network",
      params=[P("id", ref("media", "ItemId"), True, "The album id.")], result=ref("media", "AlbumDetail"), errors=[("NotFound", None)],
      example_params={"id": ALBUM["id"]},
      example_result={**ALBUM, "description": None, "trackCount": 2, "durationMs": 401000, "tracks": [TRACK, TRACK2]}),
    M("browse.artist", "Returns an artist page: description and shelves (top songs, albums, singles, videos, related artists, …).", scope="search", rate="network",
      params=[P("id", ref("media", "ItemId"), True, "The artist's channel id.")], result=ref("media", "ArtistDetail"), errors=[("NotFound", None)],
      example_params={"id": ARTIST["id"]},
      example_result={**ARTIST_ITEM, "description": "Dream pop from the coast.",
                      "sections": [{"kind": "songs", "title": "Top songs", "items": [TRACK]}, {"kind": "albums", "title": "Albums", "items": [ALBUM]}]}),
    M("browse.podcast", "Returns a podcast show and its episodes, newest first, one page at a time.", scope="search", rate="network",
      params=[P("id", ref("media", "ItemId"), True, "The podcast id."), CURSOR, LIMIT],
      result=obj(podcast=(ref("media", "PodcastDetail"), "The show; repeated on every page."), items=(array(ref("media", "Episode")), ""), nextCursor=NEXT),
      errors=[("NotFound", None)],
      example_params={"id": PODCAST["id"], "limit": 1},
      example_result={"podcast": {**PODCAST, "description": "Conversations about sound and radio."}, "items": [EPISODE], "nextCursor": "cG9kOjE"}),
    M("browse.episode", "Returns an episode with its description.", scope="search", rate="network",
      params=[P("id", ref("media", "ItemId"), True, "The episode id.")], result=ref("media", "EpisodeDetail"), errors=[("NotFound", None)],
      example_params={"id": EPISODE["id"]},
      example_result={**EPISODE, "description": "Where radio static comes from, and why we keep listening."}),
    # ---------------------------------------------------------------- rating
    M("rating.set", "Likes, dislikes or clears the rating of an item.", scope="library:write", rate="account", result=EMPTY,
      description="For a track or episode, `like` adds it to liked songs. For an album, playlist or podcast, `like` saves it to the library and `none` removes it; `dislike` is not allowed for them (`InvalidParams`).",
      params=[P("item", ref("media", "RateableRef"), True, "What to rate."), P("rating", ref("media", "Rating"), True, "")],
      errors=[("NotSignedIn", None), ("NotFound", None)],
      example_params={"item": {"type": "track", "id": "Xk3vT9pQm2A"}, "rating": "like"}, example_result={}),
    # ---------------------------------------------------------------- lyrics
    M("lyrics.get", "Returns lyrics with timings for the current item or a given track.", scope="lyrics:read", rate="network",
      description="Sonolith searches its lyrics sources and returns the best result: word-synced over line-synced over unsynced. The lookup can take several seconds. Episodes have no lyrics (`notFound`). For the current item, `lyrics.changed` reports later improvements.",
      params=[P("trackId", ref("media", "ItemId"), False, "The track's id. Default: the current item.")],
      result=ref("lyrics", "LyricsResult"), errors=[("NotFound", "no track with this id"), ("Unavailable", "`nothingPlaying` when `trackId` is omitted")],
      example_params={}, example_result={"trackId": TRACK["id"], "status": "found", "lyrics": LYRICS}),
]

# ---------------------------------------------------------------- events


def E(name, summary, *, topic=None, scope=None, params, example, description=""):
    return dict(name=name, summary=summary, topic=topic, scope=scope, params=params, example=example, description=description)


EVENTS = [
    E("player.stateChanged", "The player state changed (anything but the position moving on).", topic="player.state", scope="player:read",
      params=ref("player", "PlayerState"), example={**PLAYER_STATE, "status": "paused"},
      description="Sent when any `PlayerState` field changes, except `positionMs` and `positionAt` advancing during playback. A seek sends it. Bursts are coalesced to at most 10 per second; the last state always arrives."),
    E("player.trackChanged", "A different item became current (or none).", topic="player.track", scope="player:read",
      params=obj(item=(nullable(ref("media", "MediaItem")), "The new current item, or null.")), example={"item": TRACK2}),
    E("player.position", "The playback position, at the subscribed rate while playing.", topic="player.position", scope="player:read",
      params=ref("player", "PositionEvent"), example={"positionMs": 61750, "positionAt": NOW + 500, "durationMs": 214000, "rate": 1, "status": "playing"},
      description="Sent `positionHz` times per second while playing, and once on pause, seek and item change. Not sent while paused or stopped. Between events, extrapolate: `positionMs + (now - positionAt) * rate`."),
    E("player.volumeChanged", "The volume or mute changed.", topic="player.volume", scope="player:read",
      params=obj(volume=(ref("player", "Volume"), ""), muted=({"type": "boolean"}, "")), example={"volume": 55, "muted": False},
      description="Bursts (for example, dragging the volume slider) are coalesced to at most 10 per second."),
    E("queue.changed", "The queue's entries or current index changed.", topic="queue", scope="queue:read",
      params={"allOf": [ref("player", "QueueSummary"), obj(reason=(ref("player", "QueueChangeReason"), ""))]},
      example={**QUEUE_SUMMARY, "revision": 58, "currentIndex": 4, "reason": "advanced"},
      description="Carries the summary only; call `queue.get` for the entries. Bursts are coalesced; `revision` tells whether a copy is current."),
    E("lyrics.changed", "Lyrics for the current item were found, improved, or cleared.", topic="lyrics", scope="lyrics:read",
      params=ref("lyrics", "LyricsResult"), example={"trackId": TRACK["id"], "status": "found", "lyrics": LYRICS},
      description="Sent when the current item changes (`status` `notFound` with `lyrics` null until lyrics are found), when lyrics are found, and when a better tier replaces them. The snapshot on subscribe carries what Sonolith has now."),
    E("lyrics.line", "The line being sung changed.", topic="lyrics.line", scope="lyrics:read",
      params=ref("lyrics", "LyricsLineEvent"),
      example={"trackId": TRACK["id"], "lineIndex": 0, "text": "Lights on the water", "startMs": 12400, "endMs": 15900, "positionMs": 12410},
      description="Sent while playing synced lyrics (tier `word` or `line`), when a line starts, when a break starts (`lineIndex` null), and right after a seek."),
    E("lyrics.word", "A word or syllable started.", topic="lyrics.word", scope="lyrics:read",
      params=ref("lyrics", "LyricsWordEvent"),
      example={"trackId": TRACK["id"], "lineIndex": 0, "wordIndex": 1, "background": False, "positionMs": 12905},
      description="Sent while playing `word`-tier lyrics, for main and background vocals. This topic is busy (often 3–8 events per second); for smooth karaoke, animate from `player.position` and the word timings instead, and use this only to correct drift."),
    E("account.changed", "The user signed in to or out of YouTube in Sonolith.", topic="account", scope=None,
      params=ref("session", "AccountState"), example={"signedIn": False}),
    E("registration.resolved", "A registration, scope or identity request was answered or expired.",
      params=ref("session", "RegistrationOutcome"),
      example={"requestId": "req_5Jt2xQ", "kind": "register", "status": "approved", "token": TOKEN,
               "grantedScopes": ["player:read", "player:control"], "retryAfterMs": None},
      description="Sent only to the connection that made the request; no subscription needed. On `approved` with a `token`, store the token before anything else, then call `session.hello`."),
    E("session.revoked", "The app's access was revoked. Sonolith closes the connection right after.",
      params=ref("session", "RevokeInfo"), example={"reason": "removed"},
      description="Sent to every connection of the app; no subscription needed. The client MUST stop using Sonolith, delete the stored token, and tell the user \"Disconnected from Sonolith\"."),
    E("session.scopesChanged", "The app's granted scopes changed.",
      params=ref("session", "ScopesChanged"), example={"grantedScopes": ["player:read"], "added": [], "removed": ["player:control"]},
      description="Sent to every connection of the app; no subscription needed. Subscriptions to topics whose scope was removed end without further notice."),
]

# ---------------------------------------------------------------- schema access


def load_schemas():
    return {f: json.loads((SCHEMA_DIR / f"{f}.schema.json").read_text()) for f in SCHEMA_FILES}


SCHEMAS = load_schemas()
DEFS = {}  # name -> (file, schema)
for _f, _s in SCHEMAS.items():
    for _n, _d in _s.get("$defs", {}).items():
        assert _n not in DEFS, f"duplicate type name {_n}"
        DEFS[_n] = (_f, _d)


def ref_name(r):
    return r.rsplit("/", 1)[-1]


def anchor(text):
    return re.sub(r"[^a-z0-9_ -]", "", text.lower()).replace(" ", "-")


def type_str(s, md=True):
    """A short, readable type for tables and one-line summaries."""
    def link(n):
        return f"[{n}](#{anchor(n)})" if md else n

    bar = " \\| " if md else " | "
    if "$ref" in s:
        n = ref_name(s["$ref"])
        target = DEFS.get(n, (None, {}))[1]
        # Plain aliases (DurationMs, ItemId, …) read better as their base type.
        if n in ("DurationMs", "TimestampMs") :
            return f"integer (ms{' since epoch' if n == 'TimestampMs' else ''})"
        if n in ("ItemId", "Cursor", "AppId", "ApiVersionRequest", "ApiVersion", "Token", "Icon") or target.get("type") == "string" and "enum" not in target:
            return "string"
        if n in ("NextCursor", "ThumbnailUrl"):
            return "string" + bar + "null"
        if n == "Limit":
            return "integer (1–100)"
        return link(n)
    if "oneOf" in s:
        return bar.join(type_str(x, md) for x in s["oneOf"])
    if "allOf" in s:
        return " & ".join(type_str(x, md) for x in s["allOf"])
    if "const" in s:
        return json.dumps(s["const"])
    if "enum" in s:
        return bar.join(json.dumps(v) for v in s["enum"])
    t = s.get("type")
    if isinstance(t, list):
        return bar.join(t)
    if t == "array":
        inner = type_str(s["items"], md)
        return f"({inner})[]" if bar.strip() in inner else f"{inner}[]"
    if t == "integer" and ("minimum" in s or "maximum" in s) and (s.get("minimum"), s.get("maximum")) != (0, None):
        return f"integer ({s.get('minimum', '')}–{s.get('maximum', '')})"
    return t or "any"


def desc_of(s):
    """A field's own description, else the first sentence of its type's description."""
    if "description" in s:
        return s["description"]
    if "$ref" in s:
        d = DEFS.get(ref_name(s["$ref"]), (None, {}))[1].get("description", "")
        return d.split(". ")[0].rstrip(".") + "." if d else ""
    return ""


def cell(text):
    return (text or "").replace("|", "\\|").replace("\n", " ")


def fields_table(schema, md=True):
    props = schema.get("properties", {})
    req = set(schema.get("required", []))
    all_req = req == set(props)
    head = "| Field | Type | Description |\n|---|---|---|" if all_req else "| Field | Type | Present | Description |\n|---|---|---|---|"
    rows = []
    for k, v in props.items():
        d = cell(desc_of(v))
        if all_req:
            rows.append(f"| `{k}` | {type_str(v)} | {d} |")
        else:
            rows.append(f"| `{k}` | {type_str(v)} | {'always' if k in req else 'when relevant'} | {d} |")
    return head + "\n" + "\n".join(rows)


def compact(v):
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def show(v):
    c = compact(v)
    return c if len(c) <= 110 else json.dumps(v, ensure_ascii=False, indent=2)


def scope_text(scope, md=True):
    if scope is None:
        return "none"
    if isinstance(scope, list):
        return " or ".join(f"`{s}`" for s in scope)
    return f"`{scope}`"


def params_schema(m):
    s = {"type": "object", "additionalProperties": False,
         "properties": {p["name"]: p["schema"] for p in m["params"]},
         "required": [p["name"] for p in m["params"] if p["required"]]}
    s.update(m["params_extra"])
    return s


# ---------------------------------------------------------------- openrpc


def openrpc():
    methods = []
    for m in METHODS:
        errs = sorted({e for e, _ in m["errors"]} | set(COMMON_ERRORS) | ({"SessionRequired"} if m["session"] else set())
                      | ({"PermissionDenied"} if m["scope"] else set()), key=lambda e: ERROR_CODES[e])
        method = {
            "name": m["name"],
            "summary": m["summary"],
            "tags": [{"name": m["name"].split(".")[0]}],
            "paramStructure": "by-name",
            "params": [{"name": p["name"], "required": p["required"], "description": p["description"] or p["name"],
                        "schema": p["schema"]} for p in m["params"]],
            "result": {"name": "result", "description": m["result_desc"] or "The result.", "schema": m["result"]},
            "errors": [{"$ref": f"#/components/errors/{e}"} for e in errs],
            "examples": [{
                "name": f"{m['name']} example",
                "params": [{"name": k, "value": v} for k, v in (m["example_params"] or {}).items()],
                "result": {"name": "result", "value": m["example_result"]},
            }],
            "x-scope": m["scope"],
            "x-requires-session": m["session"],
            "x-rate-class": m["rate"],
        }
        if m["description"]:
            method["description"] = m["description"]
        if m["params_extra"]:
            method["x-params-constraints"] = m["params_extra"]
        methods.append(method)
    return {
        "openrpc": "1.3.2",
        "info": {
            "title": "Sonolith local API",
            "version": API_VERSION,
            "description": "A local JSON-RPC 2.0 API over a Unix domain socket (Linux) or a named pipe (Windows), one JSON message per line. Apps register and the user approves them; see SPEC.md for the full protocol. Server-to-client notifications are listed under `x-events`.",
            "license": {"name": "MIT", "url": "https://github.com/opecko/sonolith/blob/master/LICENSE"},
        },
        "servers": [
            {"name": "linux", "url": "unix:${XDG_RUNTIME_DIR}/sonolith/api.sock", "summary": "Unix domain socket; see discovery.json for the actual path."},
            {"name": "windows", "url": "pipe:\\\\.\\pipe\\sonolith-api-<user>", "summary": "Named pipe; read discovery.json for the actual name."},
        ],
        "methods": methods,
        "components": {
            "errors": {name: {"code": code, "message": name, "data": {"name": name, "meaning": meaning}} for code, name, meaning, _ in ERRORS},
        },
        "x-events": [{
            "name": e["name"], "summary": e["summary"], "description": e["description"] or e["summary"],
            "topic": e["topic"], "scope": e["scope"], "params": e["params"], "example": e["example"],
        } for e in EVENTS],
        "x-scopes": [{"scope": s, "label": label, "sensitive": sens, "allows": allows} for s, label, sens, allows in SCOPES],
        "x-rate-classes": [{"name": n, "limit": lim, "applies": a} for n, lim, a in RATE_CLASSES],
        "x-error-reasons": [{"reason": r, "error": e, "meaning": d} for r, e, d in REASONS],
    }


# ---------------------------------------------------------------- markdown blocks


def md_methods():
    out = []
    ns_titles = {"app": "App", "session": "Session", "events": "Events", "player": "Player", "queue": "Queue",
                 "library": "Library", "playlist": "Playlists", "search": "Search", "browse": "Browse",
                 "rating": "Ratings", "lyrics": "Lyrics"}
    req_id = 1
    last_ns = None
    for m in METHODS:
        ns = m["name"].split(".")[0]
        if ns != last_ns:
            out.append(f"### {ns_titles[ns]} (`{ns}.*`)\n")
            last_ns = ns
        out.append(f"#### `{m['name']}`\n")
        out.append(m["summary"] + "\n")
        if m["description"]:
            out.append(m["description"] + "\n")
        out.append("| Scope | Session | Rate class |\n|---|---|---|")
        out.append(f"| {scope_text(m['scope'])} | {'required' if m['session'] else 'not needed'} | `{m['rate']}` |\n")
        out.append("**Params**\n")
        if m["params"]:
            out.append("| Name | Type | Required | Description |\n|---|---|---|---|")
            for p in m["params"]:
                d = p["description"] or desc_of(p["schema"])
                if "default" in p["schema"] and "Default" not in d:
                    d = (d + " " if d else "") + f"Default `{json.dumps(p['schema']['default'])}`."
                out.append(f"| `{p['name']}` | {type_str(p['schema'])} | {'yes' if p['required'] else 'no'} | {cell(d)} |")
            out.append("")
        else:
            out.append("None. Omit `params` or send `{}`.\n")
        out.append("**Result**\n")
        r = m["result"]
        if "$ref" in r:
            n = ref_name(r["$ref"])
            out.append(("An empty object `{}`." if n == "Empty" else f"[{n}](#{anchor(n)}).") + (" " + m["result_desc"] if m["result_desc"] else "") + "\n")
        elif "allOf" in r:
            base = ref_name(r["allOf"][0]["$ref"])
            out.append(f"All fields of [{base}](#{anchor(base)}), plus:\n")
            out.append(fields_table(r["allOf"][1]) + "\n")
        else:
            out.append(fields_table(r) + "\n")
        own = []
        for e, why in m["errors"]:
            own.append(f"`{e}` ({ERROR_CODES[e]})" + (f": {why}" if why else ""))
        if m["scope"]:
            own.append(f"`PermissionDenied` ({ERROR_CODES['PermissionDenied']}): the app lacks {scope_text(m['scope'])}")
        if m["session"]:
            own.append(f"`SessionRequired` ({ERROR_CODES['SessionRequired']})")
        out.append("**Errors**\n")
        out.append("\n".join(f"- {x}" for x in own) + ("\n" if own else "") + "- the [common errors](#112-common-errors)\n")
        out.append("**Example**\n")
        reqmsg = {"jsonrpc": "2.0", "id": req_id, "method": m["name"]}
        if m["example_params"] is not None:
            reqmsg["params"] = m["example_params"]
        out.append("Request:\n\n```json\n" + compact(reqmsg) + "\n```\n")
        out.append("Response:\n\n```json\n" + show({"jsonrpc": "2.0", "id": req_id, "result": m["example_result"]}) + "\n```\n")
        req_id += 1
    return "\n".join(out)


def md_events():
    out = []
    for e in EVENTS:
        out.append(f"#### `{e['name']}`\n")
        out.append(e["summary"] + "\n")
        if e["description"]:
            out.append(e["description"] + "\n")
        out.append("| Topic | Scope |\n|---|---|")
        out.append(f"| {('`' + e['topic'] + '`') if e['topic'] else 'always delivered'} | {scope_text(e['scope']) if e['topic'] else 'none'} |\n")
        p = e["params"]
        if "$ref" in p:
            n = ref_name(p["$ref"])
            out.append(f"**Params**: [{n}](#{anchor(n)}).\n")
        elif "allOf" in p:
            base = ref_name(p["allOf"][0]["$ref"])
            out.append(f"**Params**: all fields of [{base}](#{anchor(base)}), plus:\n\n" + fields_table(p["allOf"][1]) + "\n")
        else:
            out.append("**Params**\n\n" + fields_table(p) + "\n")
        out.append("```json\n" + show({"jsonrpc": "2.0", "method": e["name"], "params": e["example"]}) + "\n```\n")
    return "\n".join(out)


def md_topics():
    rows = ["| Topic | Event | Scope |", "|---|---|---|"]
    for e in EVENTS:
        if e["topic"]:
            rows.append(f"| `{e['topic']}` | [`{e['name']}`](#{anchor(e['name'])}) | {scope_text(e['scope'])} |")
    return "\n".join(rows) + "\n"


def md_types():
    out = []
    groups = [("common", "Common"), ("media", "Music and podcast items"), ("player", "Player and queue"),
              ("lyrics", "Lyrics"), ("session", "Registration, sessions and events")]
    skip = {"DurationMs", "TimestampMs", "Cursor", "Limit", "NextCursor", "ThumbnailUrl", "ItemId", "AppId",
            "ApiVersionRequest", "ApiVersion", "Token", "Icon", "Empty"}
    for f, title in groups:
        out.append(f"### {title}\n")
        for n, s in SCHEMAS[f]["$defs"].items():
            if n in skip:
                continue
            out.append(f"#### {n}\n")
            if "description" in s:
                out.append(s["description"] + "\n")
            if "enum" in s:
                out.append("One of: " + ", ".join(f"`{json.dumps(v)}`" for v in s["enum"]) + ".\n")
            elif "oneOf" in s:
                out.append("One of: " + ", ".join(type_str(x) for x in s["oneOf"]) + ".\n")
            elif "allOf" in s:
                base = ref_name(s["allOf"][0]["$ref"])
                out.append(f"All fields of [{base}](#{anchor(base)}), plus:\n\n" + fields_table(s["allOf"][1]) + "\n")
            elif "properties" in s:
                out.append(fields_table(s) + "\n")
    out.append("### Simple types\n")
    out.append("| Type | Meaning |\n|---|---|")
    for n in ["ItemId", "DurationMs", "TimestampMs", "Cursor", "NextCursor", "Limit", "ThumbnailUrl", "AppId", "ApiVersionRequest", "ApiVersion", "Token", "Icon", "Empty"]:
        out.append(f"| {n} | {cell(DEFS[n][1]['description'])} |")
    return "\n".join(out) + "\n"


def md_errors():
    rows = ["| Code | Name | Meaning | What the client does |", "|---|---|---|---|"]
    for code, name, meaning, todo in ERRORS:
        rows.append(f"| {code} | `{name}` | {cell(meaning)} | {cell(todo)} |")
    return "\n".join(rows) + "\n"


def md_reasons():
    rows = ["| Reason | Error | Meaning |", "|---|---|---|"]
    for r, e, d in REASONS:
        rows.append(f"| `{r}` | `{e}` | {cell(d)} |")
    return "\n".join(rows) + "\n"


def methods_for_scope(scope):
    ms = [m["name"] for m in METHODS if m["scope"] == scope or (isinstance(m["scope"], list) and scope in m["scope"])]
    ts = [e["topic"] for e in EVENTS if e["scope"] == scope and e["topic"]]
    return ms, ts


def md_scopes():
    rows = ["| Scope | The user sees | Sensitive | Allows | Methods | Topics |", "|---|---|---|---|---|---|"]
    for s, label, sens, allows in SCOPES:
        ms, ts = methods_for_scope(s)
        rows.append(f"| `{s}` | {label} | {'**yes**' if sens else 'no'} | {cell(allows)} | {', '.join(f'`{m}`' for m in ms)} | {', '.join(f'`{t}`' for t in ts) or '—'} |")
    return "\n".join(rows) + "\n"


def md_rates():
    rows = ["| Class | Limit | Applies to |", "|---|---|---|"]
    for n, lim, a in RATE_CLASSES:
        ms = [m["name"] for m in METHODS if m["rate"] == n]
        rows.append(f"| `{n}` | {lim} | {a} {', '.join(f'`{m}`' for m in ms)} |")
    return "\n".join(rows) + "\n"


def llms_methods():
    out = []
    for m in METHODS:
        ps = ", ".join(f"{p['name']}{'' if p['required'] else '?'}: {type_str(p['schema'], md=False)}" for p in m["params"])
        r = m["result"]
        rs = "{}" if r.get("$ref", "").endswith("/Empty") else (
            type_str(r, md=False) if "$ref" in r else
            ("QueueSummary & " if "allOf" in r else "") + "{" + ", ".join(f"{k}: {type_str(v, md=False)}" for k, v in (r["allOf"][1] if "allOf" in r else r)["properties"].items()) + "}")
        auth = scope_text(m["scope"], md=False).replace("`", "") if m["scope"] else ("no session" if not m["session"] else "session")
        out.append(f"- {m['name']}({ps}) -> {rs} [{auth}] {m['summary']}")
    return "\n".join(out) + "\n"


def llms_events():
    out = []
    for e in EVENTS:
        p = e["params"]
        ps = type_str(p, md=False) if "$ref" in p else (
            ("QueueSummary & " if "allOf" in p else "") + "{" + ", ".join(f"{k}: {type_str(v, md=False)}" for k, v in (p["allOf"][1] if "allOf" in p else p)["properties"].items()) + "}")
        where = f"topic {e['topic']}, {e['scope'] or 'no scope'}" if e["topic"] else "always delivered"
        out.append(f"- {e['name']}: {ps} [{where}] {e['summary']}")
    return "\n".join(out) + "\n"


def llms_types():
    out = []
    for f in ["media", "player", "lyrics", "session"]:
        for n, s in SCHEMAS[f]["$defs"].items():
            if "properties" in s:
                out.append(f"- {n} {{" + ", ".join(f"{k}: {type_str(v, md=False)}" for k, v in s["properties"].items()) + "}")
            elif "allOf" in s:
                base = ref_name(s["allOf"][0]["$ref"])
                out.append(f"- {n} = {base} + {{" + ", ".join(f"{k}: {type_str(v, md=False)}" for k, v in s["allOf"][1]["properties"].items()) + "}")
            elif "oneOf" in s:
                out.append(f"- {n} = " + " | ".join(type_str(x, md=False) for x in s["oneOf"]))
            elif "enum" in s:
                out.append(f"- {n} = " + " | ".join(json.dumps(v) for v in s["enum"]))
    return "\n".join(out) + "\n"


def llms_errors():
    return "\n".join(f"- {code} {name}: {meaning} -> {todo}" for code, name, meaning, todo in ERRORS) + "\n"


def llms_scopes():
    return "\n".join(f"- {s} (\"{label}\"{', sensitive' if sens else ''}): {allows}" for s, label, sens, allows in SCOPES) + "\n"


def md_identity():
    rows = ["| Case | Process | Identity key |", "|---|---|---|"]
    for c in IDENTITY_CASES:
        p = c["process"]
        bits = [f"exe `{p['exe']}`", "argv `" + " ".join(p["argv"]) + "`", f"cwd `{p['cwd']}`"]
        bits += [f"`{k}={v}`" for k, v in p["env"].items()]
        if p["flatpakId"]:
            bits.append(f"Flatpak `{p['flatpakId']}`")
        rows.append(f"| {cell(c['name'])} | {cell(', '.join(bits))} | `{cell(c['identity']['key'])}` |")
    return "\n".join(rows) + "\n"


# ---------------------------------------------------------------- TypeScript (the frontend's side of the API)

TS_OUT = API.parent / "src" / "localApi" / "schema.gen.ts"


def ts(s):
    """A TypeScript type for a schema."""
    if "$ref" in s:
        return ref_name(s["$ref"])
    if "oneOf" in s:
        return " | ".join(ts(x) for x in s["oneOf"])
    if "allOf" in s:
        return " & ".join(ts(x) for x in s["allOf"])
    if "const" in s:
        return json.dumps(s["const"])
    if "enum" in s:
        return " | ".join(json.dumps(v) for v in s["enum"])
    t = s.get("type")
    if isinstance(t, list):
        return " | ".join(ts({**s, "type": x}) for x in t)
    if t == "array":
        inner = ts(s["items"])
        return f"({inner})[]" if "|" in inner or "&" in inner else f"{inner}[]"
    if t == "object":
        props = s.get("properties", {})
        if not props:
            return "Record<string, never>"
        req = set(s.get("required", []))
        return "{ " + "; ".join(f"{k}{'' if k in req else '?'}: {ts(v)}" for k, v in props.items()) + " }"
    return {"integer": "number", "number": "number", "string": "string", "boolean": "boolean", "null": "null"}.get(t, "unknown")


def ts_doc(text, indent=""):
    return f"{indent}/** {text} */\n" if text else ""


def ts_types():
    out = ["// Generated by api/tools/generate.py from api/schema/ and the method tables. Do not edit.\n"]
    for f in SCHEMA_FILES:
        for n, s in SCHEMAS[f].get("$defs", {}).items():
            out.append(ts_doc(s.get("description", "")) + f"export type {n} = {ts(s)};\n")
    out.append("\n/** Every method's params and result. */\nexport interface Methods {\n")
    for m in METHODS:
        params = ts({"type": "object", "properties": {p["name"]: p["schema"] for p in m["params"]},
                     "required": [p["name"] for p in m["params"] if p["required"]]})
        out.append(ts_doc(m["summary"], "  ") + f"  {json.dumps(m['name'])}: {{ params: {params}; result: {ts(m['result'])} }};\n")
    out.append("}\n\nexport type MethodName = keyof Methods;\n")
    out.append("\n/** Every event's params. */\nexport interface Events {\n")
    for e in EVENTS:
        out.append(ts_doc(e["summary"], "  ") + f"  {json.dumps(e['name'])}: {ts(e['params'])};\n")
    out.append("}\n\n/** Error names and their JSON-RPC codes. */\nexport const ERROR_CODES = {\n")
    out += [f"  {name}: {code},\n" for code, name, _, _ in ERRORS]
    out.append("} as const;\n\nexport type ErrorName = keyof typeof ERROR_CODES;\n")
    out.append("\n/** Scopes in display order: what the user sees and what each allows. */\nexport const SCOPES: readonly { scope: Scope; label: string; sensitive: boolean; allows: string }[] = [\n")
    out += [f"  {{ scope: {json.dumps(s)}, label: {json.dumps(label)}, sensitive: {'true' if sens else 'false'}, allows: {json.dumps(allows)} }},\n"
            for s, label, sens, allows in SCOPES]
    out.append("];\n")
    return "".join(out)


SPEC_BLOCKS = {"methods": md_methods, "events": md_events, "topics": md_topics, "types": md_types,
               "errors": md_errors, "reasons": md_reasons, "scopes": md_scopes, "rates": md_rates,
               "identity": md_identity}
LLMS_BLOCKS = {"methods": llms_methods, "events": llms_events, "types": llms_types, "errors": llms_errors, "scopes": llms_scopes}


def fill(text, blocks, path):
    for name, fn in blocks.items():
        pat = re.compile(rf"(<!-- BEGIN GENERATED: {name} -->\n).*?(<!-- END GENERATED: {name} -->)", re.S)
        if not pat.search(text):
            raise SystemExit(f"{path}: missing block {name}")
        body = fn()
        text = pat.sub(lambda mt: mt.group(1) + body + mt.group(2), text)
    return text


# ---------------------------------------------------------------- checks


def validate_examples():
    try:
        import jsonschema
        from referencing import Registry, Resource
    except ImportError:
        raise SystemExit("--check needs the jsonschema package (pip install jsonschema)")
    registry = Registry().with_resources(
        [(s["$id"], Resource.from_contents(s)) for s in SCHEMAS.values()])
    errors = []

    def check(schema, value, what):
        wrapped = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": BASE_URI + "openrpc.json", **schema}
        v = jsonschema.Draft202012Validator(wrapped, registry=registry, format_checker=jsonschema.FormatChecker())
        for err in v.iter_errors(value):
            errors.append(f"{what}: {err.message} at {list(err.absolute_path)}")

    for f, s in SCHEMAS.items():
        jsonschema.Draft202012Validator.check_schema(s)
    for m in METHODS:
        check(params_schema(m), m["example_params"] or {}, f"{m['name']} params")
        check(m["result"], m["example_result"], f"{m['name']} result")
        for e, _ in m["errors"]:
            assert e in ERROR_CODES, e
    for e in EVENTS:
        check(e["params"], e["example"], f"{e['name']} params")
    for c in IDENTITY_CASES:
        check(ref("session", "AppIdentity"), c["identity"], f"identity case {c['name']!r}")
    # Every method needs a scope from the list; every topic in the Topic enum has exactly one event.
    scope_names = [s for s, *_ in SCOPES]
    assert scope_names == SCHEMAS["common"]["$defs"]["Scope"]["enum"], "SCOPES and the Scope enum differ"
    topics = [e["topic"] for e in EVENTS if e["topic"]]
    assert sorted(topics) == sorted(SCHEMAS["session"]["$defs"]["Topic"]["enum"]), "topics and the Topic enum differ"
    # Anchors must be unique (GitHub would suffix duplicates and break links).
    anchors = [anchor(m["name"]) for m in METHODS] + [anchor(e["name"]) for e in EVENTS] + [anchor(n) for n in DEFS]
    dupes = {a for a in anchors if anchors.count(a) > 1}
    assert not dupes, f"duplicate anchors {dupes}"
    # Every in-page link in SPEC.md must hit a heading (GitHub-style anchors).
    spec = (API / "SPEC.md").read_text()
    spec_no_code = re.sub(r"```.*?```", "", spec, flags=re.S)
    heads = {anchor(h.replace("`", "")) for h in re.findall(r"^#+ (.+)$", spec_no_code, re.M)}
    for target in sorted(set(re.findall(r"\]\(#([^)]+)\)", spec_no_code))):
        if target not in heads:
            errors.append(f"SPEC.md: broken link #{target}")
    # JSON examples written by hand in SPEC.md and llms.txt must parse and be valid messages.
    for path in (API / "SPEC.md", API / "llms.txt"):
        for i, block in enumerate(re.findall(r"```json\n(.*?)```", path.read_text(), re.S)):
            # A block is one (possibly pretty-printed) JSON value, or newline-delimited messages.
            try:
                json.loads(block)
                continue
            except json.JSONDecodeError:
                pass
            for line in block.strip().splitlines():
                try:
                    json.loads(line)
                except json.JSONDecodeError as ex:
                    errors.append(f"{path.name} json block {i}: {ex}: {line[:80]}")
    if errors:
        raise SystemExit("\n".join(errors))


def main():
    check = "--check" in sys.argv
    outputs = {
        API / "openrpc.json": json.dumps(openrpc(), indent=2, ensure_ascii=False) + "\n",
        API / "SPEC.md": fill((API / "SPEC.md").read_text(), SPEC_BLOCKS, "SPEC.md"),
        API / "llms.txt": fill((API / "llms.txt").read_text(), LLMS_BLOCKS, "llms.txt"),
        TS_OUT: ts_types(),
    }
    stale = [p.name for p, t in outputs.items() if not p.exists() or p.read_text() != t]
    if check:
        validate_examples()
        if stale:
            raise SystemExit(f"stale: {', '.join(stale)} (run api/tools/generate.py)")
        print("api: up to date, examples valid")
        return
    for p, t in outputs.items():
        p.parent.mkdir(exist_ok=True)
        p.write_text(t)
    print(f"api: wrote {', '.join(stale) or 'nothing (up to date)'}")


if __name__ == "__main__":
    main()
