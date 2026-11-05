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

## Local play log

See `src/recap/playLog.ts` (state machine) and `src-tauri/src/recap.rs` (storage). One JSON line per play in
`<app data dir>/recap/log/YYYY-MM.jsonl`, append-only; a later line with the same `id` replaces an earlier one
(checkpoints while playing). A torn last line (crash mid-write) is skipped. Nothing is recorded with
Settings → Recaps → "Keep a local listening log" off, or with "Save history" off.
