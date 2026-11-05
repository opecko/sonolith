# Sonolith Recap

Monthly and yearly listening recaps, computed on the user's computer from two sources: YouTube Music's own history
and Sonolith's local play log. This page covers the data sources, the data model and how to extend the story player.

## YouTube Music history (what the API really gives)

Measured against a real account in November 2026 (`FEmusic_history`, WEB_REMIX, `hl=en`):

- **One page, no continuation.** The response is a single `sectionListRenderer` with `musicShelfRenderer` sections
  and no continuation token. It holds at most **200 items**; with daily listening that reaches back roughly two
  months. A full fetch takes about 1.5 s.
- **Each video appears once**, under the section of its most recent play: no repeated entries, no play counts.
- **Section headers are coarse buckets**, not days: `Today`, `Yesterday`, `This week`, `Last week`, then whole
  months with the year (`October 2026`, `September 2026`). Weekday names and plain dates did not appear, but the
  parser accepts them (and dates without a year, inferring it) in case YouTube changes the buckets.
- **Filter chips** `Music` and `Podcasts` are separate lists of up to 200 each. The default list (no chip) mixes
  both. The Podcasts list reaches further back because episodes are played less often.
- **Items** are `musicResponsiveListItemRenderer` with three flex columns: title (watch endpoint), byline (artists
  with `MUSIC_PAGE_TYPE_ARTIST` browse ids; videos show the channel and a views count; episodes link the show), and
  album (`MUSIC_PAGE_TYPE_ALBUM`, empty for videos and episodes). The duration is in the fixed column, the video type
  in the play button's `musicVideoType` (`ATV` song, `OMV`/`UGC` music video, `PODCAST_EPISODE`). The existing
  `mapRawItem` parser maps all of this to `Track`.

Consequences for Recaps:

- The import runs when Recaps opens and at most once a day otherwise, and **accumulates observations** on disk:
  every import sees each video in one bucket, and an observation that overlaps a stored one for the same video is the
  same play (the stored range narrows to the overlap, so a play seen as "Today" and later as "This week" keeps its
  exact day). A non-overlapping one is another play.
- A play only seen in a wide bucket (`This week`, a month) has a day range, not a day. It counts toward the period
  containing its range; day-level stats (streaks, busiest day, calendar, hours) use only plays with an exact day.
- Sonolith's own plays are in the local log with exact times and real listened time, so the history import mainly
  adds plays from other devices.

## Google Takeout import

The history page's 200-video cap makes older months thin, so Settings → Recaps can import Google Takeout's
`watch-history.json` (YouTube and YouTube Music, history format **JSON**; Takeout's default is HTML, which is
refused with a hint). Each entry is one play with an exact time; only `header: "YouTube Music"` entries count. The
title carries a localized "Watched …" prefix (stripped for the common languages), the byline is the channel
(" - Topic" stripped). There is no length, album or cover: `merge.ts` borrows them from the same video or song in
the log or the history, else the length is estimated. Stored as `takeout.json`; re-imports add only new
(video, time) pairs (`recap/takeout.ts`, tested on synthetic entries). Sonolith's own plays are in Takeout too, so
each logged play takes its nearest Takeout twin on the same day.

## Local play log

See `src/recap/playLog.ts` (state machine) and `src-tauri/src/recap.rs` (storage). One JSON line per play in
`<app data dir>/recap/log/YYYY-MM.jsonl`, append-only; a later line with the same `id` replaces an earlier one
(checkpoints while playing). A torn last line (crash mid-write) is skipped. Nothing is recorded with
Settings → Recaps → "Keep a local listening log" off, or with "Save history" off.

## Data model

| Step | Module | What it does |
| --- | --- | --- |
| Record | `recap/playLog.ts` (pure), `recap/recorder.ts`, `src-tauri/src/recap.rs` | `PlayTracker` follows the playing element's events (`playing`, `pause`, `waiting`, `seeking`/`seeked`, `timeupdate`, `ended`, hide, quit). Listened time counts only media time that moved at a plausible rate, so pauses and seeks don't count. A play counts at the history ping's threshold (`countsAsPlay`: 10 s or half a short track); a track left before that is a `skipped` entry. Checkpoints every 30 s and on pause / track change / hide / quit. |
| Import | `recap/ytHistory.ts` (pure), `recap/importer.ts` | `bucketRange` turns section headers into day ranges (never guesses unknown ones), `mergeObservations` accumulates imports per account (`history/a<authUser>[-<pageId>].json`). |
| Merge | `recap/merge.ts` | Three sources: log, Takeout (exact times) and the history page (day ranges); per (day, track) the largest count wins. `trackKey` = bare title (no "(Official Video)", no "Artist - " prefix) + primary artist without " - Topic"/"VEVO". Per (day, track) the larger count of log and history wins; history plays in wide buckets count only when no local play of that track is inside them. History plays' listened time is the track length (`estimated`). |
| Periods | `recap/periods.ts` | Months open on the 1st of the next month at local midnight; the year covers Jan 1 → Dec 1, or → the moment of an early unlock (offered Oct 15 – Nov 30). Minimum 20 plays (month) / 50 (year). Plays without a time go by the middle day of their range. |
| Stats | `recap/stats.ts` | `computeStats` (pure): totals, top 5s, streaks, hours/weekdays (≥ 30 exactly known plays), discoveries vs everything earlier, repeat champion, most skipped (log only, ≥ 3 skips), yearly journey and loyalty, milestones, comparison, persona (`personaOf`, fixed rules). `ELIGIBLE` says which stats a recap can show. |
| Freeze | `recap/snapshot.ts`, `recap/store.ts` | `buildSnapshot` → a versioned `Snapshot` (`SNAPSHOT_SCHEMA`) in `snapshots/<period id>.json`. A frozen one is never replaced (`keepFrozen`); only the dev toolkit resets them. Signed in, a recap freezes only after a history import from the last hour that ran after the period ended; otherwise it's a preview from the local log (not saved). Signed out it freezes from the log. |
| Present | `recap/deck.ts`, `recap/slides.ts`, `recap/games.ts`, `recap/playlists.ts` | Per viewing, from a random seed: which cards, their order, style, mood, games. Copy variants are picked by the seed, so Replay reshuffles the words too. |
| Show | `recap/player/` | The story player (lazy-loaded chunk), card styles in `player/styles/`, games, finale and playlist actions. Colors: `theme/recapPalette.ts` (five moods from the top covers' source colors, every text pair ≥ 4.5:1) as `--rc-*` variables on the overlay. |

Other files under `<app data dir>/recap/`: `meta.json` (early unlocks, recaps seen, saved playlist ids). Settings →
Recaps deletes the log or everything; exporting writes `sonolith-listening-log-<date>.json` to Downloads (the name is
fixed in Rust, only the date comes from the frontend).

Time in Recaps comes from `recap/clock.ts` (`clockNow`), so the dev toolkit's time travel moves unlocks and periods
without touching playback or the log.

## The story player

- The card is designed at **360 × 640 units** and scaled as a whole: sizes are `U(n)` = `calc(var(--u) * n)`.
- One card is mounted at a time; the next card's images are preloaded.
- Motion goes through `player/anim.ts` on the shared engine: `useEntrance(ms, frame)` runs one tween that writes
  styles to `data-e` elements per frame and lands on the final state (immediately with animations off or while
  hidden); `useLoop` is for the few loops (marquee, twinkle, shimmer), which the engine stops while hidden or with
  animations off. No CSS transform/opacity animations (WebKitGTK flashes when they end), no blur.
- Keys: ←/→, Space (pause auto-advance), Esc, 1–4 in games. The app's own shortcuts are off while the player is open
  (`shortcuts/init.ts`). The navigation rules are pure (`player/nav.ts`) and tested.
- Each card has an `aria` sentence, announced through a polite live region.

## Adding a slide style

1. Add its metadata to `STYLES` in `recap/styles.ts`: `id`, `name`, a `family` (cards in a row never share one) and
   the data `shapes` it can draw (`number`, `rank`, `hero`, `series`, `calendar`, `pair`, `text`, `covers`;
   `seriesLength` if it only fits one length, like the 24-hour clock).
2. Write the component in `recap/player/styles/` (`StyleProps`: `slide`, `data`, `hold`). Draw **every** shape you
   declared; `parts.tsx` has `listOf`, `bigText`, `smallText`, `Cover`, `Head`. Colors only through `var(--rc-…)`.
   Entrance with `useEntrance`; the static end state must look finished (animations off).
3. Register it in `recap/player/styles/index.tsx`. `player/nav.test.ts` fails if the two lists differ, and
   `deck.test.ts` checks the deck rules with the new style in the pool.
4. Review it in the dev toolkit's **Style gallery** (Dev build chip → Recaps), in every mood.

## Adding a stat or card

Compute it in `stats.ts` (null when the data can't support it, with a test on synthetic data), add its eligibility
to `ELIGIBLE`, and a card in `slides.ts` with at least three headline variants. Games: `games.ts`
(`eligibleGames` + `makeGame`; decoys from the user's own data, answer always present).
