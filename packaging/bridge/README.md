# ytdesk is now Sonolith

ytdesk was renamed to **Sonolith**: same app, new name. It lives at **https://github.com/opecko/sonolith**.

This repository only exists so that ytdesk's built-in updater (which looks here) can install Sonolith: its releases
are copies of Sonolith's, with the Windows installer under the name ytdesk expects. Updating keeps your settings,
sign-in, queue and everything else.

- **Windows**: accept the update in ytdesk, or download the installer from the
  [Sonolith releases](https://github.com/opecko/sonolith/releases/latest). It replaces ytdesk.
- **Arch Linux**: `yay -Syu` moves `ytdesk-bin` / `ytdesk` over to `sonolith-bin` / `sonolith`.
- **Debian / Ubuntu**: install `sonolith_…_amd64.deb` from the Sonolith releases; it replaces the ytdesk package.
