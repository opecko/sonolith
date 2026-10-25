# Local API: manual test checklist (fish)

For what automated tests can't reach: your real YouTube account, the real consent dialog, Settings. Everything runs
in a fish terminal against the running app (`node_modules/.bin/tauri dev`, or an installed build) with `socat` and `jq`.
Automated coverage is in `src-tauri/src/api/tests.rs` (server, over a real socket) and
`src/localApi/dispatch.test.ts` (dispatcher with fakes).

**Not verified before this checklist (check these closely):** `playlist.create` with `privacy` / `items` (raw
`/playlist/create`), `rating.set` on an album (the OLAK playlist lookup) and on a podcast, `playlist.removeTracks`
(entry ids are video ids), and how everything looks in both styles (M3 and Classic).

> Writes to your account. Use only the playlists this checklist creates (all named `SNL test …`); don't point the
> destructive calls at your own playlists. Delete the leftovers at the end (step 9).

## 0. Setup

```fish
cd <your clone of the repo>
source docs/dev/api-manual-test.fish
echo $SNL_SOCK    # should be .../sonolith/api.sock
```

- [ ] Sonolith → Settings → **Connected apps**: switch **off** by default. `ls $SNL_SOCK` fails (no endpoint).
- [ ] Turn the switch **on**. A "Socket" row appears with the path; the copy button puts it in the clipboard
      (`wl-paste`) and shows "Copied to clipboard". `ls -l $SNL_SOCK` shows `srw-------`. `cat $XDG_RUNTIME_DIR/sonolith/discovery.json` has `pid` = Sonolith's pid (`pgrep -x sonolith`).
- [ ] "API reference" opens the SPEC in the browser.
- [ ] The page looks right in **Classic** and **Material** (Settings → Look → style), light and dark.

## 1. Consent: deny, cooldown, allow, block

```fish
snl-register                  # all scopes offered
```

- [ ] A system notification "Manual test wants to connect to Sonolith" appears; clicking it shows the window.
- [ ] The dialog shows: app name, "by Me", description; **Program** `/usr/bin/socat1` (or `/usr/bin/socat`); "Manual test wants to:" with
      one line per scope (label + reason); `player:read` has no checkbox, the others are ticked; **Change your library** has the warning icon.
- [ ] Esc and a click outside do nothing (only the buttons answer).
- [ ] Press **Deny**. The terminal says status `denied`, `retryAfterMs` ≈ 600000, no token.
- [ ] Run `snl-register` again at once: `RegistrationDenied` straight away, **no dialog** appears.
- [ ] Restart the app (the cooldown persists), run it again: still `RegistrationDenied`.
- [ ] Settings → Connected apps shows no app yet. To clear the cooldown for the next steps: quit Sonolith, delete the denial from
      `~/.local/share/dev.sonolith.app/api-apps.json` (`"denials": []`), start it again. (Or wait 10 min.)
- [ ] `snl-register queue:read library:read`: only those two optional scopes are asked. **Untick** `library:read`, press **Allow**.
      Terminal: `approved`, `grantedScopes` = `["player:read","queue:read"]`, a `snl_…` token; `cat $SNL_TOKEN_FILE` has it.
- [ ] `grep -c snl_ ~/.local/share/dev.sonolith.app/api-apps.json` prints 0: the token is stored only as a hash.
- [ ] `snl app.info | jq .session` shows the granted scopes and the identity. `snl player.getState` works (while something plays: item, position, status).
- [ ] `snl library.playlists` → `PermissionDenied`, `data.scope` `library:read`. `snl player.play` → `PermissionDenied` (`player:control`).
- [ ] Settings → Connected apps lists "Manual test" with a green dot (a connection is open during a call only, so refresh: the dot is off when idle),
      "Not connected", last used "just now".
- [ ] **Block:** run `snl-register` while registered (it asks again and says an app with this id is connected), press **Deny and block this app**.
      Then `snl-register` → `Blocked`, no dialog. `snl app.info` still works (no session needed) but `snl player.getState` → `hello: failed` with `Blocked`.
      Settings → **Blocked apps** lists it; **Unblock** removes it. Then register again and **Allow** everything for the next steps.

## 2. Scopes you need for the rest

```fish
snl-register          # tick everything, Allow
snl app.info | jq -c .session.grantedScopes
```

- [ ] All eight scopes are granted. Sign in to YouTube in Sonolith first (Library works).

## 3. Playlists: create, read, rename

```fish
set id (snl playlist.create '{"title":"SNL test one","privacy":"private"}' | jq -r .id); echo $id
snl playlist.get '{"id":"'$id'"}'
snl library.playlists '{"limit":5}' | jq -r '.items[].title'
```

- [ ] `playlist.create` returns `{"type":"playlist","id":"PL…","title":"SNL test one","editable":true,…}`.
- [ ] "SNL test one" appears at the top of the sidebar playlists within a second; after ~10 s it is still there (not dropped by the lagging listing).
- [ ] `playlist.get` shows the playlist with no items, `nextCursor` null.
- [ ] In music.youtube.com (browser) the playlist exists, is **Private**.
- [ ] Create one with items, description and unlisted privacy:
      ```fish
      set songs (snl search.query '{"query":"radiohead creep","type":"songs","limit":3}' | jq -r '.items[].id'); echo $songs
      set id2 (snl playlist.create '{"title":"SNL test two","description":"made by the API","privacy":"unlisted","items":[{"type":"track","id":"'$songs[1]'"},{"type":"track","id":"'$songs[2]'"}]}' | jq -r .id)
      snl playlist.get '{"id":"'$id2'"}' | jq '.playlist.title, (.items | length)'
      ```
      - [ ] The playlist has 2 tracks and the sidebar count says 2 tracks. On the web: description set, **Unlisted**.
- [ ] Rename: `snl playlist.rename '{"id":"'$id'","title":"SNL test one (renamed)"}'` → `{}`; the sidebar title changes at once and the open playlist page too; on the web as well.
- [ ] Rename with a bad id: `snl playlist.rename '{"id":"PLdoesnotexist1234567890","title":"x"}'` → an error (`NotFound` or `Unavailable`/`notEditable`), not `InternalError`.

## 4. Add and remove tracks

```fish
snl playlist.addTracks '{"id":"'$id'","items":[{"type":"track","id":"'$songs[1]'"},{"type":"track","id":"'$songs[2]'"},{"type":"track","id":"'$songs[1]'"}]}'
snl playlist.addTracks '{"id":"'$id'","items":[{"type":"track","id":"'$songs[1]'"}]}'
snl playlist.addTracks '{"id":"'$id'","items":[{"type":"track","id":"'$songs[1]'"}],"allowDuplicates":true}'
snl playlist.get '{"id":"'$id'"}' | jq -c '[.items[] | {entryId, t: .item.title}]'
```

- [ ] First call: `{"added":2,"skipped":1}` (the repeated id in one request counts as skipped).
- [ ] Second: `{"added":0,"skipped":1}`. Third: `{"added":1,"skipped":0}`; the playlist now has the song twice.
- [ ] The sidebar count follows (3 tracks); the playlist page shows the tracks after a refresh.
- [ ] The playlist now holds `songs[1]` twice. `playlist.get` lists **two entries with the same `item.id` and different `entryId`s**
      (16 hex characters, not equal to the video id): `snl playlist.get '{"id":"'$id'"}' | jq -c '[.items[] | {entryId, id: .item.id}]'`.
- [ ] Remove **one copy**: take the second entry of the duplicated song,
      `set e (snl playlist.get '{"id":"'$id'"}' | jq -r '[.items[] | select(.item.id=="'$songs[1]'")][1].entryId')`, then
      `snl playlist.removeTracks '{"id":"'$id'","entryIds":["'$e'"]}'` → `{"removed":1}`. The playlist (here and on the web) still has the song **once**,
      and it is the first copy (check the entry ids: the first one is unchanged, the removed one is gone).
- [ ] Remove by a video id on purpose: `entryIds:["'$songs[2]'"]` → `{"removed":0}` and nothing changes (an item id is not an entry id).
- [ ] Remove two entries at once (`entryIds` with the remaining entries of songs 1 and 2) → `{"removed":2}`; the playlist is empty, the sidebar count follows.
- [ ] Someone else's playlist: take a saved (not yours) playlist id from `snl library.playlists | jq -r '.items[] | select(.editable==false) | .id'`
      and try `playlist.addTracks`, `playlist.rename`, and `playlist.removeTracks` with an `entryId` from its `playlist.get` on it → each `Unavailable` with reason `notEditable`; nothing changes on YouTube.
- [ ] `playlist.get` with only `search` (register a second app, or revoke `library:read` in step 7) on your private playlist → `NotFound`.

## 5. Ratings

```fish
set t $songs[1]
snl rating.set '{"item":{"type":"track","id":"'$t'"},"rating":"like"}'
```

- [ ] `{}`; the song is in **Liked Music** (sidebar/Library → Liked songs, and on the web) within a few seconds.
- [ ] If that song is playing in Sonolith, its heart in the player bar turns on **at once** (the rating is remembered in the app).
- [ ] `snl library.likedSongs '{"limit":3}' | jq -r '.items[] | "\(.title) \(.rating)"'` lists it with `like`.
- [ ] `none` removes it from Liked Music. `dislike` while it **plays** skips to the next song (like the button) and the rating is `dislike` on the web; then set it back to `none`.
- [ ] Album save: `set alb (snl search.query '{"query":"radiohead ok computer","type":"albums","limit":1}' | jq -r '.items[0].id')`, then
      `snl rating.set '{"item":{"type":"album","id":"'$alb'"},"rating":"like"}'` → `{}`; the album is in Library → Albums. `none` removes it. **This is one of the unverified paths.**
- [ ] `{"item":{"type":"album","id":"…"},"rating":"dislike"}` → `InvalidParams`, `data.path` `/rating`.
- [ ] Podcast save: search a podcast (`"type":"podcasts"`), `rating.set` with `"type":"podcast"` `like`/`none` → appears/disappears in Library → Podcasts.
- [ ] Signed out (Settings → sign out): `rating.set` and `playlist.create` → `NotSignedIn`. Sign in again.

## 6. Delete

```fish
snl playlist.delete '{"id":"'$id'"}'
snl playlist.delete '{"id":"'$id2'"}'
```

- [ ] Each returns `{}`; both disappear from the sidebar at once and are gone on the web after a refresh.
- [ ] Deleting a playlist that isn't yours → `Unavailable`/`notEditable` (try the saved playlist id from step 4; **nothing** should be deleted from your library).

## 7. Revoke while connected

Terminal A: `snl-follow player.state account`. Terminal B for the commands.

- [ ] Settings → Connected apps → **Manual test**: the detail page shows the program, Connected "Connected now", the scopes with a **Revoke** each,
      and recent activity listing the calls you made in this session (repeated calls folded as `×N`).
- [ ] **Revoke** "Change your library" (confirm the dialog). Terminal A prints `session.scopesChanged` with `removed:["library:write"]`.
      Terminal B: `snl rating.set …` → `PermissionDenied`, `data.scope` `library:write`.
- [ ] Revoke `player:read` while A follows `player.state`: A gets `scopesChanged`, and no more `player.stateChanged` events arrive.
- [ ] Run `snl-register` again (an app with this id is already connected): the dialog says so, and **Allow** replaces the token: A gets
      `session.revoked` with reason `replaced`, and the old token no longer works.
- [ ] **Remove** (detail page → Remove, confirm). Terminal A prints `session.revoked` (`removed`) and ends. `snl app.info` → `session: null`;
      `snl player.getState` → `hello: failed` with `NotRegistered` (the token is dead). The app is gone from the list.
- [ ] Register again (Allow all), then **Block** from the detail page: A gets `session.revoked` (`blocked`); `snl-register` → `Blocked`; Blocked apps lists it; **Unblock**.
- [ ] Register two test apps (change `SNL_APP`: `set -g SNL_APP com.example.manualtwo; set -g SNL_TOKEN_FILE ~/.config/sonolith-manual/token2`), then **Remove all** (confirm): both gone, blocked apps stay.
- [ ] **App disconnects itself:** register, `snl-unregister` → `{}`; the app is gone from Settings and a toast says "Manual test disconnected from Sonolith".

## 8. Switch and lifecycle

- [ ] With an app following (A), turn the switch **off**: A ends; `ls $SNL_SOCK` fails; discovery.json is gone; Settings still lists the apps.
- [ ] Switch **on**: the same token still works (`snl player.getState`).
- [ ] Quit Sonolith from the tray: the socket and discovery.json are removed. Start it again: the switch is still on, the endpoint is back, the token works.
- [ ] Start a second Sonolith (second launch only raises the window): nothing breaks; `ls` shows one socket.
- [ ] `kill -9` Sonolith, start it again: it takes over the stale socket (no "address in use").
- [ ] While the window is **hidden** (close to tray): `snl-follow player.position lyrics.line` keeps getting events while playing (subscribe with `lyrics:read`); lyrics of the playing song still arrive.
- [ ] A consent request while the window is hidden: the notification shows; clicking it brings the window up with the dialog.

## 9. Clean up

```fish
snl library.playlists '{"limit":50}' | jq -r '.items[] | select(.title | startswith("SNL test")) | .id'   # should print nothing
snl-unregister
rm -rf ~/.config/sonolith-manual
```

- [ ] No `SNL test` playlists left (sidebar and web); nothing left in Liked Music or Library that you didn't want.
- [ ] Note down anything that failed with the exact reply (`snl …` prints `error`, `reason`, `data`).
