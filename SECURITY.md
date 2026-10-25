# Security policy

## Reporting a vulnerability

**Please don't open a public issue or pull request for a security problem.** Report it privately with GitHub's
private vulnerability reporting: go to the repository's **Security** tab → **Report a vulnerability**
(<https://github.com/opecko/sonolith/security/advisories/new>). Include what you found, how to reproduce it, the
Sonolith version and your OS. Don't include your YouTube cookie or other credentials in the report.

You'll get a reply as soon as the maintainer can, usually within a week. Sonolith is maintained in spare time, so
fixes follow the severity; you'll be credited in the advisory if you want to be.

## Supported versions

Only the latest release gets security fixes.

## Scope

In scope:

- The **local API** for other apps (the Unix socket / named pipe, `api/SPEC.md`): authentication, consent and scopes,
  app identity checks, rate limits, anything that lets a program do more than the user allowed, or that lets another
  local user reach the socket.
- Storage of the sign-in cookie and API tokens, the update check and installer download, URL handling (what the app
  opens or downloads), and the Rust backend's handling of untrusted input (stream proxy, yt-dlp invocation).
- The webview's exposure to remote content.

Out of scope: problems in YouTube, Google, yt-dlp or other third-party services themselves, issues that need a
machine the attacker already controls as the same user, and denial of service by the local user against their own
session.
