// Recap statistics: pure functions of the merged plays (merge.ts). Everything is deterministic for the same input, and
// a stat that the data can't honestly support is null (its slide and games then don't appear). No genres: YouTube
// doesn't give them.
import { hourOf, ymdOf } from "./days";
import type { Play } from "./merge";

export interface TrackStat {
  key: string;
  videoId: string;
  title: string;
  artist: string;
  artistId: string | null;
  album: string | null;
  thumbnail?: string;
  /** A music video: playlists prefer the song when there is one. */
  video: boolean;
  plays: number;
  listenedMs: number;
  /** Last play (epoch ms, or the start of its day), for tie-breaks. */
  lastAt: number;
  /** Most plays in a single day ("On repeat"). */
  bestDay: number;
}

export interface ArtistStat {
  key: string;
  id: string | null;
  name: string;
  plays: number;
  listenedMs: number;
  /** Cover of the artist's most played track. */
  thumbnail?: string;
  topTrack: string;
}

export interface AlbumStat {
  key: string;
  id: string | null;
  title: string;
  artist: string;
  plays: number;
  listenedMs: number;
  thumbnail?: string;
}

export interface Persona {
  id: "explorer" | "loyalist" | "nightOwl" | "earlyBird" | "repeater" | "marathoner" | "weekender" | "eclectic";
  name: string;
  line: string;
}

export interface MonthStat {
  month: number;
  plays: number;
  listenedMs: number;
  topArtist: string | null;
  topTrack: string | null;
}

export interface RecapStats {
  plays: number;
  listenedMs: number;
  /** Share of listening time that is the track length rather than measured (history plays from other devices). */
  estimatedShare: number;
  uniqueTracks: number;
  uniqueArtists: number;
  uniqueAlbums: number;
  /** Days with at least one play known to the day. */
  daysListened: number;
  daysInPeriod: number;
  longestStreak: { days: number; from: number; to: number } | null;
  busiestDay: { day: number; plays: number; listenedMs: number } | null;
  /** Plays per local hour / weekday (0 = Sunday), only with enough exactly timed plays. */
  byHour: number[] | null;
  byWeekday: number[] | null;
  /** Plays per day of the period (day-known plays only), for the calendar and waveform. */
  daily: { day: number; plays: number; listenedMs: number }[];
  topArtists: ArtistStat[];
  topTracks: TrackStat[];
  topAlbums: AlbumStat[];
  /** Up to 100 tracks in playlist order (plays, then listened time, then recency). */
  rankedTracks: TrackStat[];
  discoveries: { tracks: number; share: number; artists: number; top: TrackStat[] } | null;
  repeatChampion: { track: TrackStat; day: number; plays: number } | null;
  obsessionWeek: { track: TrackStat; weekStart: number; plays: number } | null;
  firstPlay: { track: TrackStat; at: number } | null;
  lastPlay: { track: TrackStat; at: number } | null;
  mostSkipped: { track: TrackStat; skips: number } | null;
  artistLoyalty: { artist: ArtistStat; months: number } | null;
  podcasts: { episodes: number; shows: number; listenedMs: number; topShow: string } | null;
  journey: MonthStat[] | null;
  milestones: { n: number; day: number; track: TrackStat }[];
  comparison: { prevPlays: number; prevListenedMs: number; deltaMs: number; deltaPct: number } | null;
  fun: { daysNonstop: number; flights: number; albumsBackToBack: number };
  persona: Persona;
  // Yearly extras (optional: snapshots made before they existed don't have them).
  /** Artists and songs ranked 6–10. */
  moreArtists?: ArtistStat[];
  moreTracks?: TrackStat[];
  /** The #1 artist's most played songs. */
  topArtistSongs?: TrackStat[];
  /** Winter, spring, summer, autumn: each season's top song and artist (only seasons with listening). */
  seasons?: SeasonStat[];
}

export interface SeasonStat {
  id: "winter" | "spring" | "summer" | "autumn";
  plays: number;
  listenedMs: number;
  topTrack: TrackStat;
  topArtist: string;
}

export interface StatsInput {
  /** Plays inside the period (from playsIn). */
  plays: Play[];
  /** Every play before the period starts (for discoveries and milestones). */
  before: Play[];
  /** Skipped tracks inside the period (log only). */
  skips: Play[];
  /** Plays of the previous period, when there's data for it (null: no comparison). */
  previous: Play[] | null;
  kind: "month" | "year";
  /** First and last day (inclusive) of the period as covered. */
  firstDay: number;
  lastDay: number;
  includePodcasts: boolean;
}

/** Exactly timed plays needed before hours and weekdays mean something. */
export const MIN_TIMED = 30;
export const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000];

const artistKey = (p: Play) => (p.artists[0] ? p.artists[0].id ?? `n:${p.artists[0].name.toLowerCase()}` : "n:");
const albumKey = (p: Play) => (p.album ? p.album.id ?? `n:${p.album.title.toLowerCase()}|${artistKey(p)}` : null);
const whenOf = (p: Play) => p.at ?? p.to * 86_400_000;
const exactDay = (p: Play) => (p.from === p.to ? p.from : null);

function rankBy<T extends { plays: number; listenedMs: number; key: string }>(list: T[], last?: (t: T) => number): T[] {
  return list.sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs || (last ? last(b) - last(a) : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function trackStats(plays: Play[]): Map<string, TrackStat> {
  const m = new Map<string, TrackStat>();
  for (const p of plays) {
    let t = m.get(p.key);
    if (!t) {
      t = { key: p.key, videoId: p.videoId, title: p.title, artist: p.artists.map((a) => a.name).join(", ") || "Unknown artist", artistId: p.artists[0]?.id ?? null, album: p.album?.title ?? null, video: p.type === "video", plays: 0, listenedMs: 0, lastAt: 0, bestDay: 0 };
      m.set(p.key, t);
    }
    t.plays++;
    t.listenedMs += p.listenedMs;
    // The song's own version wins over its music video for what's shown and played.
    if (t.video && p.type === "song") Object.assign(t, { videoId: p.videoId, title: p.title, video: false, album: p.album?.title ?? t.album });
    if (p.thumbnail && (!t.thumbnail || whenOf(p) >= t.lastAt)) t.thumbnail = p.thumbnail;
    if (!t.album && p.album) t.album = p.album.title;
    t.lastAt = Math.max(t.lastAt, whenOf(p));
  }
  return m;
}

const asTrack = (tracks: Map<string, TrackStat>, p: Play) => tracks.get(p.key)!;

export function computeStats(input: StatsInput): RecapStats {
  const keep = (p: Play) => input.includePodcasts || p.type !== "episode";
  const plays = input.plays.filter(keep);
  const music = plays.filter((p) => p.type !== "episode");
  const tracks = trackStats(plays);
  const ranked = rankBy([...tracks.values()], (t) => t.lastAt);

  // Artists and albums: music only (a show isn't an artist).
  const artists = new Map<string, ArtistStat & { best: Map<string, number> }>();
  const albums = new Map<string, AlbumStat>();
  for (const p of music) {
    const k = artistKey(p);
    let a = artists.get(k);
    if (!a) artists.set(k, (a = { key: k, id: p.artists[0]?.id ?? null, name: p.artists[0]?.name ?? "Unknown artist", plays: 0, listenedMs: 0, topTrack: "", best: new Map() }));
    a.plays++;
    a.listenedMs += p.listenedMs;
    a.best.set(p.key, (a.best.get(p.key) ?? 0) + 1);
    const ak = albumKey(p);
    if (ak) {
      let al = albums.get(ak);
      if (!al) albums.set(ak, (al = { key: ak, id: p.album!.id, title: p.album!.title, artist: p.artists[0]?.name ?? "", plays: 0, listenedMs: 0 }));
      al.plays++;
      al.listenedMs += p.listenedMs;
      if (p.thumbnail && !al.thumbnail) al.thumbnail = p.thumbnail;
    }
  }
  for (const a of artists.values()) {
    const best = [...a.best].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0];
    const t = best && tracks.get(best[0]);
    a.topTrack = t?.title ?? "";
    a.thumbnail = t?.thumbnail;
  }
  const topArtists = rankBy([...artists.values()]).map(({ best: _best, ...a }) => a).slice(0, 10);
  const topAlbums = rankBy([...albums.values()]);

  // Days.
  const daily = new Map<number, { plays: number; listenedMs: number }>();
  for (const p of plays) {
    const d = exactDay(p);
    if (d === null) continue;
    const e = daily.get(d) ?? { plays: 0, listenedMs: 0 };
    e.plays++;
    e.listenedMs += p.listenedMs;
    daily.set(d, e);
  }
  const days = [...daily.keys()].sort((a, b) => a - b);
  let streak: RecapStats["longestStreak"] = null;
  for (let i = 0; i < days.length; ) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
    const len = j - i + 1;
    if (!streak || len > streak.days) streak = { days: len, from: days[i], to: days[j] };
    i = j + 1;
  }
  let busiest: RecapStats["busiestDay"] = null;
  for (const d of days) {
    const e = daily.get(d)!;
    if (!busiest || e.plays > busiest.plays || (e.plays === busiest.plays && e.listenedMs > busiest.listenedMs)) busiest = { day: d, ...e };
  }

  const timed = plays.filter((p) => p.at !== null);
  const byHour = timed.length >= MIN_TIMED ? Array.from({ length: 24 }, (_, h) => timed.filter((p) => hourOf(p.at!) === h).length) : null;
  const dayKnown = plays.filter((p) => exactDay(p) !== null);
  const byWeekday = dayKnown.length >= MIN_TIMED ? Array.from({ length: 7 }, (_, w) => dayKnown.filter((p) => ymdOf(p.from).weekday === w).length) : null;

  // Discoveries: tracks never played before the period.
  const known = new Set(input.before.map((p) => p.key));
  const knownArtists = new Set(input.before.filter((p) => p.type !== "episode").map(artistKey));
  const fresh = ranked.filter((t) => !known.has(t.key));
  const discoveries = input.before.length > 0 && plays.length > 0
    ? { tracks: fresh.length, share: plays.filter((p) => !known.has(p.key)).length / plays.length, artists: [...artists.keys()].filter((k) => !knownArtists.has(k)).length, top: fresh.slice(0, 50) }
    : null;

  // Most plays of one track in one day, and in one week (weeks start on Monday).
  let repeat: RecapStats["repeatChampion"] = null;
  let week: RecapStats["obsessionWeek"] = null;
  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  for (const p of plays) {
    const d = exactDay(p);
    if (d === null) continue;
    const kd = `${d}|${p.key}`;
    perDay.set(kd, (perDay.get(kd) ?? 0) + 1);
    const ws = d - ((ymdOf(d).weekday + 6) % 7);
    const kw = `${ws}|${p.key}`;
    perWeek.set(kw, (perWeek.get(kw) ?? 0) + 1);
  }
  for (const [k, n] of perDay) {
    const t = tracks.get(k.slice(k.indexOf("|") + 1))!;
    t.bestDay = Math.max(t.bestDay, n);
  }
  const best = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  const bd = best(perDay);
  if (bd && bd[1] >= 3) repeat = { track: tracks.get(bd[0].slice(bd[0].indexOf("|") + 1))!, day: Number(bd[0].split("|")[0]), plays: bd[1] };
  const bw = best(perWeek);
  if (bw && bw[1] >= 5) week = { track: tracks.get(bw[0].slice(bw[0].indexOf("|") + 1))!, weekStart: Number(bw[0].split("|")[0]), plays: bw[1] };

  const byTime = [...plays].filter((p) => p.at !== null).sort((a, b) => a.at! - b.at!);
  const firstPlay = byTime.length >= 2 ? { track: asTrack(tracks, byTime[0]), at: byTime[0].at! } : null;
  const lastPlay = byTime.length >= 2 ? { track: asTrack(tracks, byTime.at(-1)!), at: byTime.at(-1)!.at! } : null;

  // Skips: log only, and only a track skipped a few times says anything.
  const skips = input.skips.filter(keep);
  const skipTracks = trackStats(skips);
  const sk = rankBy([...skipTracks.values()], (t) => t.lastAt)[0];
  const mostSkipped = sk && sk.plays >= 3 ? { track: sk, skips: sk.plays } : null;

  // Yearly: artist loyalty and the month-by-month journey.
  let artistLoyalty: RecapStats["artistLoyalty"] = null;
  let journey: RecapStats["journey"] = null;
  if (input.kind === "year") {
    const months = new Map<string, Set<number>>();
    for (const p of music) {
      const k = artistKey(p);
      const s = months.get(k) ?? new Set();
      s.add(ymdOf(Math.floor((p.from + p.to) / 2)).m);
      months.set(k, s);
    }
    const loyal = topArtists
      .map((a) => ({ a, n: months.get(a.key)?.size ?? 0 }))
      .sort((x, y) => y.n - x.n || y.a.plays - x.a.plays)[0];
    if (loyal && loyal.n >= 3) artistLoyalty = { artist: loyal.a, months: loyal.n };
    const first = ymdOf(input.firstDay).m, last = ymdOf(input.lastDay).m;
    const j: MonthStat[] = [];
    for (let m = first; m <= last; m++) {
      const mp = plays.filter((p) => ymdOf(Math.floor((p.from + p.to) / 2)).m === m);
      const mt = rankBy([...trackStats(mp).values()], (t) => t.lastAt)[0];
      const ma = new Map<string, { n: string; c: number }>();
      for (const p of mp.filter((x) => x.type !== "episode")) {
        const e = ma.get(artistKey(p)) ?? { n: p.artists[0]?.name ?? "", c: 0 };
        e.c++;
        ma.set(artistKey(p), e);
      }
      const top = [...ma.values()].sort((a, b) => b.c - a.c || (a.n < b.n ? -1 : 1))[0];
      j.push({ month: m, plays: mp.length, listenedMs: mp.reduce((s, p) => s + p.listenedMs, 0), topArtist: top?.n ?? null, topTrack: mt?.title ?? null });
    }
    if (j.filter((x) => x.plays > 0).length >= 3) journey = j;
  }

  // Podcasts.
  let podcasts: RecapStats["podcasts"] = null;
  const eps = plays.filter((p) => p.type === "episode");
  if (input.includePodcasts && eps.length >= 3) {
    const shows = new Map<string, number>();
    for (const e of eps) shows.set(e.artists[0]?.name ?? "", (shows.get(e.artists[0]?.name ?? "") ?? 0) + e.listenedMs);
    const top = [...shows].sort((a, b) => b[1] - a[1])[0];
    podcasts = { episodes: new Set(eps.map((e) => e.key)).size, shows: shows.size, listenedMs: eps.reduce((s, e) => s + e.listenedMs, 0), topShow: top[0] };
  }

  // Milestones: the nth play of all time landing inside the period.
  const prior = input.before.filter(keep).length;
  const ordered = [...plays].sort((a, b) => whenOf(a) - whenOf(b));
  const milestones = MILESTONES.filter((n) => n > prior && n <= prior + ordered.length).map((n) => {
    const p = ordered[n - prior - 1];
    return { n, day: Math.floor((p.from + p.to) / 2), track: asTrack(tracks, p) };
  });

  const listenedMs = plays.reduce((s, p) => s + p.listenedMs, 0);
  const estimatedMs = plays.filter((p) => p.estimated).reduce((s, p) => s + p.listenedMs, 0);
  let comparison: RecapStats["comparison"] = null;
  const prev = input.previous?.filter(keep);
  if (prev && prev.length >= 10) {
    const prevMs = prev.reduce((s, p) => s + p.listenedMs, 0);
    comparison = { prevPlays: prev.length, prevListenedMs: prevMs, deltaMs: listenedMs - prevMs, deltaPct: prevMs > 0 ? Math.round(((listenedMs - prevMs) / prevMs) * 100) : 0 };
  }

  const base = {
    plays: plays.length,
    listenedMs,
    estimatedShare: listenedMs > 0 ? estimatedMs / listenedMs : 0,
    uniqueTracks: tracks.size,
    uniqueArtists: artists.size,
    uniqueAlbums: albums.size,
    daysListened: days.length,
    daysInPeriod: input.lastDay - input.firstDay + 1,
    longestStreak: streak && streak.days >= 2 ? streak : null,
    busiestDay: busiest,
    byHour,
    byWeekday,
    daily: days.map((d) => ({ day: d, ...daily.get(d)! })),
    topArtists: topArtists.slice(0, 5),
    topTracks: ranked.slice(0, 5),
    topAlbums: topAlbums.filter((a) => a.plays >= 2).slice(0, 5),
    rankedTracks: ranked.slice(0, 100),
    discoveries,
    repeatChampion: repeat,
    obsessionWeek: week,
    firstPlay,
    lastPlay,
    mostSkipped,
    artistLoyalty,
    podcasts,
    journey,
    milestones,
    comparison,
    fun: {
      daysNonstop: listenedMs / 86_400_000,
      // A long-haul flight of about 9 hours.
      flights: listenedMs / (9 * 3_600_000),
      // An album of about 45 minutes.
      albumsBackToBack: listenedMs / (45 * 60_000),
    },
  };
  const extras: Pick<RecapStats, "moreArtists" | "moreTracks" | "topArtistSongs" | "seasons"> = {};
  if (input.kind === "year") {
    if (topArtists.length >= 8) extras.moreArtists = topArtists.slice(5, 10);
    if (ranked.length >= 8) extras.moreTracks = ranked.slice(5, 10);
    const top = topArtists[0];
    const own = top ? ranked.filter((t) => (top.id ? t.artistId === top.id : t.artist.split(", ")[0] === top.name)).slice(0, 5) : [];
    if (own.length >= 3) extras.topArtistSongs = own;
    // Seasons by month: Dec–Feb winter (December of this year), Mar–May spring, Jun–Aug summer, Sep–Nov autumn.
    const seasonOf = (m: number) => (m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn");
    const seasons: SeasonStat[] = [];
    for (const id of ["winter", "spring", "summer", "autumn"] as const) {
      const sp = plays.filter((p) => seasonOf(ymdOf(Math.floor((p.from + p.to) / 2)).m) === id && p.type !== "episode");
      if (sp.length < 10) continue;
      const tt = rankBy([...trackStats(sp).values()], (t) => t.lastAt)[0];
      const counts = new Map<string, number>();
      for (const p of sp) counts.set(p.artists[0]?.name ?? "", (counts.get(p.artists[0]?.name ?? "") ?? 0) + 1);
      const ta = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      // The track as the whole year knows it (its cover and totals), with this season's own count shown.
      seasons.push({ id, plays: sp.length, listenedMs: sp.reduce((a, p) => a + p.listenedMs, 0), topTrack: { ...(tracks.get(tt.key) ?? tt), plays: tt.plays }, topArtist: ta });
    }
    if (seasons.length >= 2) extras.seasons = seasons;
  }
  return { ...base, ...extras, persona: personaOf(base, plays) };
}

/**
 * The listening persona: the first rule that fits, in a fixed order; always flattering, never a judgment. Each
 * comes with one line of evidence from the user's own numbers.
 */
export function personaOf(s: Omit<RecapStats, "persona">, plays: Play[]): Persona {
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const timed = plays.filter((p) => p.at !== null);
  const share = (f: (h: number) => boolean) => (timed.length >= MIN_TIMED ? timed.filter((p) => f(hourOf(p.at!))).length / timed.length : 0);
  const top = s.topArtists[0];
  const night = share((h) => h >= 22 || h < 4);
  const morning = share((h) => h >= 5 && h < 9);
  const weekend = s.byWeekday ? (s.byWeekday[0] + s.byWeekday[6]) / Math.max(1, s.byWeekday.reduce((a, b) => a + b, 0)) : 0;
  const perDay = s.daysListened > 0 ? s.listenedMs / s.daysListened : 0;
  if (s.discoveries && s.discoveries.share >= 0.5) return { id: "explorer", name: "The Explorer", line: `${pct(s.discoveries.share)} of your plays were songs new to you.` };
  if (top && s.plays > 0 && top.plays / s.plays >= 0.25) return { id: "loyalist", name: "The Loyalist", line: `${top.name} was in ${pct(top.plays / s.plays)} of your plays.` };
  if (night >= 0.35) return { id: "nightOwl", name: "The Night Owl", line: `${pct(night)} of your listening happened after 10 PM.` };
  if (morning >= 0.3) return { id: "earlyBird", name: "The Early Bird", line: `${pct(morning)} of your listening happened before 9 AM.` };
  if (s.repeatChampion && s.repeatChampion.plays >= 5) return { id: "repeater", name: "The Repeater", line: `You played "${s.repeatChampion.track.title}" ${s.repeatChampion.plays} times in one day.` };
  if (perDay >= 3 * 3_600_000) return { id: "marathoner", name: "The Marathoner", line: `About ${Math.round(perDay / 3_600_000)} hours of music on the days you listened.` };
  if (weekend >= 0.45) return { id: "weekender", name: "The Weekend Listener", line: `${pct(weekend)} of your plays were on weekends.` };
  return { id: "eclectic", name: "The Eclectic", line: `${s.uniqueArtists} artists and ${s.uniqueTracks} songs: a bit of everything.` };
}

/** Which stats a recap can honestly show; slides and games ask these. */
export const ELIGIBLE = {
  totalTime: (s: RecapStats) => s.listenedMs > 0,
  totalPlays: (s: RecapStats) => s.plays > 0,
  topArtist: (s: RecapStats) => s.topArtists.length > 0,
  topArtists: (s: RecapStats) => s.topArtists.length >= 3,
  topTrack: (s: RecapStats) => s.topTracks.length > 0,
  topTracks: (s: RecapStats) => s.topTracks.length >= 3,
  topAlbums: (s: RecapStats) => s.topAlbums.length >= 3,
  variety: (s: RecapStats) => s.uniqueArtists >= 3,
  daysListened: (s: RecapStats) => s.daysListened >= 3,
  streak: (s: RecapStats) => !!s.longestStreak && s.longestStreak.days >= 3,
  busiestDay: (s: RecapStats) => !!s.busiestDay && s.busiestDay.plays >= 5,
  hours: (s: RecapStats) => !!s.byHour,
  weekdays: (s: RecapStats) => !!s.byWeekday,
  calendar: (s: RecapStats) => s.daily.length >= 5,
  discoveries: (s: RecapStats) => !!s.discoveries && s.discoveries.tracks >= 3,
  repeatChampion: (s: RecapStats) => !!s.repeatChampion,
  obsessionWeek: (s: RecapStats) => !!s.obsessionWeek,
  firstLast: (s: RecapStats) => !!s.firstPlay && !!s.lastPlay && s.firstPlay.track.key !== s.lastPlay.track.key,
  mostSkipped: (s: RecapStats) => !!s.mostSkipped,
  artistLoyalty: (s: RecapStats) => !!s.artistLoyalty,
  podcasts: (s: RecapStats) => !!s.podcasts,
  journey: (s: RecapStats) => !!s.journey,
  milestone: (s: RecapStats) => s.milestones.length > 0,
  comparison: (s: RecapStats) => !!s.comparison && Math.abs(s.comparison.deltaPct) >= 5,
  fun: (s: RecapStats) => s.listenedMs >= 3_600_000,
  persona: () => true,
} as const satisfies Record<string, (s: RecapStats) => boolean>;

export type StatId = keyof typeof ELIGIBLE;

