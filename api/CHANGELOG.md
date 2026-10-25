# Sonolith API changelog

The API's own version history, separate from Sonolith's app changelog. The API follows semantic versioning; see
"Versioning" in [SPEC.md](SPEC.md) for the compatibility promise and the deprecation policy.

## 1.0.0 (draft)

The first version of the local API. Not yet in a released Sonolith.

- Transport: Unix domain socket (Linux) and named pipe (Windows), discovery file, newline-delimited JSON-RPC 2.0.
- Registration with user consent (`app.register`, `registration.resolved`), client tokens bound to the app
  identity (normalized for interpreters, AppImage, Flatpak and versioned install folders; `identity` in results),
  `session.hello`, incremental scopes (`app.requestScopes`), `app.unregister`, revocation (`session.revoked`,
  `session.scopesChanged`).
- Scopes: `player:read`, `player:control`, `queue:read`, `queue:write`, `library:read`, `library:write`, `search`,
  `lyrics:read`.
- Methods: `app.*`, `session.hello`, `events.*`, `player.*`, `queue.*`, `library.*`, `playlist.*`, `search.*`,
  `browse.*`, `rating.set`, `lyrics.get`.
- Spam protection: after a denial the app waits `retryAfterMs` before asking again (1 min, then 10 min, then 1 h;
  the count starts again after an approval or a day without a denial); the user can lift it in Settings.
- Event topics: `player.state`, `player.track`, `player.position`, `player.volume`, `queue`, `lyrics`, `lyrics.line`,
  `lyrics.word`, `account`.
