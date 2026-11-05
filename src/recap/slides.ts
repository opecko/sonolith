// What each recap card says: its data (in one of the shapes styles know how to draw) and its words. Pure: built
// from a frozen snapshot's stats. Every headline has at least three variants; which one a card uses is decided by
// the deck's seed, so a viewing reads the same until Replay reshuffles it.
import { formatDay, MONTHS, MONTHS_SHORT, WEEKDAYS } from "./days";
import { approx, duration, fmtInt, HOURS_LABEL, minutesOf, plural } from "./format";
import type { Period } from "./periods";
import { hash } from "./random";
import { ELIGIBLE, type RecapStats, type TrackStat } from "./stats";
import type { Shape } from "./styles";

export type PlayTarget =
  | { kind: "track"; videoId: string; title: string; artist: string; thumbnail?: string }
  | { kind: "artist"; id: string; name: string };

export interface Item {
  label: string;
  sub?: string;
  value?: number;
  valueText?: string;
  image?: string;
  play?: PlayTarget;
}

export type SlideData =
  | { shape: "number"; value: number; display: string; unit: string; caption?: string }
  | { shape: "rank"; items: Item[] }
  | { shape: "hero"; item: Item; kicker?: string; stat?: string }
  | { shape: "series"; values: number[]; labels: string[]; highlight: number; unit: string }
  | { shape: "calendar"; days: { day: number; value: number }[]; from: number; to: number; highlight: number | null }
  | { shape: "pair"; left: Item; right: Item; verdict?: string }
  | { shape: "text"; big: string; lines: string[] }
  | { shape: "covers"; images: string[]; caption?: string };

export type SlideKind =
  | "intro" | "totalTime" | "totalPlays" | "topArtist" | "topArtists" | "topTrack" | "topTracks" | "topAlbums" | "variety"
  | "daysListened" | "streak" | "busiestDay" | "hours" | "weekdays" | "calendar" | "discoveries" | "repeatChampion"
  | "obsessionWeek" | "firstLast" | "mostSkipped" | "artistLoyalty" | "podcasts" | "journey" | "milestone" | "comparison"
  | "fun" | "persona" | "coverWall" | "buildUp" | "outro" | "finale" | "game";

export interface SlideContent {
  kind: SlideKind;
  data: SlideData;
  /** Another way to draw the same thing (a ranked list as a cover wall), for more style variety. */
  alt?: SlideData;
  headline: string;
  sub?: string;
  /** What a screen reader hears for the whole card. */
  aria: string;
  /** Normal auto-advance time, ms. */
  duration: number;
  play?: PlayTarget;
}

export interface CopyContext {
  period: Period;
  /** "October", "2026". */
  label: string;
  /** "this month", "this year". */
  span: string;
  seed: number;
}

/** One of the variants, stable for this seed and card. */
function choose(ctx: CopyContext, kind: string, variants: string[]): string {
  return variants[hash(`${ctx.seed}|${kind}`) % variants.length];
}

const trackItem = (t: TrackStat, value?: number): Item => ({
  label: t.title,
  sub: t.artist,
  image: t.thumbnail,
  value,
  valueText: value === undefined ? undefined : plural(value, "play"),
  play: { kind: "track", videoId: t.videoId, title: t.title, artist: t.artist, thumbnail: t.thumbnail },
});

const DUR = { number: 6000, rank: 8500, hero: 7000, series: 7500, calendar: 7500, pair: 7000, text: 6500, covers: 6500 } satisfies Record<Shape, number>;

/** Every card the stats allow, in a neutral order (the deck builder arranges them). */
export function buildContents(s: RecapStats, ctx: CopyContext, opts: { coveredFrom: number; /** First day of the period. */ periodStart: number; youtube: boolean; log: boolean }): SlideContent[] {
  const out: SlideContent[] = [];
  const add = (c: Omit<SlideContent, "duration"> & { duration?: number }) => out.push({ duration: DUR[c.data.shape], ...c });
  const year = ctx.period.kind === "year";
  const min = minutesOf(s.listenedMs);
  const since = opts.coveredFrom > opts.periodStart ? `Based on your listening since ${formatDay(opts.coveredFrom)}.` : undefined;
  const sources = opts.youtube && opts.log ? "From your YouTube Music history and Sonolith's own log." : opts.youtube ? "From your YouTube Music history." : "From Sonolith's listening log on this computer.";

  add({
    kind: "intro",
    data: { shape: "text", big: ctx.label, lines: [since ?? sources] },
    headline: choose(ctx, "intro", year
      ? [`${ctx.label}, played back`, `Your ${ctx.label} in music`, `Here's how ${ctx.label} sounded`]
      : [`Your ${ctx.label} in music`, `${ctx.label}, played back`, `Here's how ${ctx.label} sounded`]),
    sub: year ? "Get comfortable. This one's long." : "Let's see what you've been playing.",
    aria: `Sonolith Recap for ${ctx.label}. ${since ?? sources}`,
    duration: year ? 7000 : 5000,
  });

  add({
    kind: "totalTime",
    data: { shape: "number", value: min, display: fmtInt(min), unit: "minutes", caption: `${duration(s.listenedMs)} across ${plural(s.daysListened || s.daysInPeriod, "day")}` },
    headline: choose(ctx, "totalTime", [`You listened for ${fmtInt(min)} minutes`, "Minutes of music", `That's a lot of ${ctx.label}`]),
    sub: s.estimatedShare > 0.2 ? "Partly estimated from song lengths." : undefined,
    aria: `You listened for ${fmtInt(min)} minutes ${ctx.span}.`,
  });

  if (ELIGIBLE.totalPlays(s))
    add({
      kind: "totalPlays",
      data: { shape: "number", value: s.plays, display: fmtInt(s.plays), unit: "plays", caption: `${plural(s.uniqueTracks, "different song")}` },
      headline: choose(ctx, "totalPlays", ["Press play, again and again", `${fmtInt(s.plays)} plays`, "Every play counted"]),
      aria: `${fmtInt(s.plays)} plays of ${plural(s.uniqueTracks, "different song")}.`,
    });

  const a = s.topArtists[0];
  if (a) {
    const play: PlayTarget | undefined = a.id ? { kind: "artist", id: a.id, name: a.name } : undefined;
    add({
      kind: "buildUp",
      data: { shape: "text", big: "#1", lines: ["One artist stood out", "above everyone else…"] },
      headline: choose(ctx, "buildUp", ["Drumroll, please", "And your top artist is…", "One name kept coming back"]),
      aria: "Your top artist is coming up next.",
      duration: 3500,
    });
    add({
      kind: "topArtist",
      data: { shape: "hero", item: { label: a.name, sub: `Most played: ${a.topTrack}`, image: a.thumbnail, value: a.plays, valueText: plural(a.plays, "play"), play }, kicker: "Top artist", stat: `${duration(a.listenedMs)} together` },
      headline: choose(ctx, "topArtist", [`${a.name} was your #1`, `Your top artist: ${a.name}`, `Nobody beat ${a.name}`]),
      aria: `Your top artist ${ctx.span} was ${a.name}, with ${plural(a.plays, "play")}.`,
      play,
    });
  }
  if (ELIGIBLE.topArtists(s))
    add({
      kind: "topArtists",
      data: { shape: "rank", items: s.topArtists.map((x) => ({ label: x.name, sub: x.topTrack, image: x.thumbnail, value: x.plays, valueText: plural(x.plays, "play"), play: x.id ? { kind: "artist", id: x.id, name: x.name } : undefined })) },
      alt: { shape: "covers", images: s.topArtists.map((x) => x.thumbnail).filter((x): x is string => !!x) },
      headline: choose(ctx, "topArtists", ["Your top artists", "The usual suspects", "Your most played artists"]),
      aria: `Your top artists: ${s.topArtists.map((x, i) => `${i + 1}, ${x.name}`).join("; ")}.`,
    });

  const t = s.topTracks[0];
  if (t)
    add({
      kind: "topTrack",
      data: { shape: "hero", item: trackItem(t, t.plays), kicker: "Top song", stat: duration(t.listenedMs) },
      headline: choose(ctx, "topTrack", [`Your song: ${t.title}`, "The one you couldn't skip", `On repeat: ${t.title}`]),
      aria: `Your top song ${ctx.span} was ${t.title} by ${t.artist}, played ${plural(t.plays, "time")}.`,
      play: trackItem(t).play,
    });
  if (ELIGIBLE.topTracks(s))
    add({
      kind: "topTracks",
      data: { shape: "rank", items: s.topTracks.map((x) => trackItem(x, x.plays)) },
      alt: { shape: "covers", images: s.topTracks.map((x) => x.thumbnail).filter((x): x is string => !!x) },
      headline: choose(ctx, "topTracks", ["Your top songs", "The soundtrack of " + ctx.label, "Songs you played the most"]),
      aria: `Your top songs: ${s.topTracks.map((x, i) => `${i + 1}, ${x.title} by ${x.artist}`).join("; ")}.`,
    });
  if (ELIGIBLE.topAlbums(s))
    add({
      kind: "topAlbums",
      data: { shape: "rank", items: s.topAlbums.map((x) => ({ label: x.title, sub: x.artist, image: x.thumbnail, value: x.plays, valueText: plural(x.plays, "play") })) },
      alt: { shape: "covers", images: s.topAlbums.map((x) => x.thumbnail).filter((x): x is string => !!x) },
      headline: choose(ctx, "topAlbums", ["Albums on heavy rotation", "Your top albums", "Front to back, again"]),
      aria: `Your top albums: ${s.topAlbums.map((x, i) => `${i + 1}, ${x.title}`).join("; ")}.`,
    });
  const covers = [...new Set(s.rankedTracks.map((x) => x.thumbnail).filter((x): x is string => !!x))].slice(0, 16);
  if (covers.length >= 9)
    add({
      kind: "coverWall",
      data: { shape: "covers", images: covers, caption: `${plural(s.uniqueTracks, "song")} in all` },
      headline: choose(ctx, "coverWall", ["A wall of what you played", "Your " + ctx.label + " in covers", "So many covers"]),
      aria: `A wall of covers from the ${covers.length} songs you played most.`,
    });

  if (ELIGIBLE.variety(s))
    add({
      kind: "variety",
      data: { shape: "number", value: s.uniqueArtists, display: fmtInt(s.uniqueArtists), unit: "artists", caption: `${plural(s.uniqueTracks, "song")}${s.uniqueAlbums ? `, ${plural(s.uniqueAlbums, "album")}` : ""}` },
      headline: choose(ctx, "variety", ["A wide-open playlist", "So many voices", `${fmtInt(s.uniqueArtists)} artists ${ctx.span}`]),
      aria: `You listened to ${plural(s.uniqueArtists, "artist")} and ${plural(s.uniqueTracks, "song")}.`,
    });

  if (ELIGIBLE.daysListened(s))
    add({
      kind: "daysListened",
      data: { shape: "number", value: s.daysListened, display: fmtInt(s.daysListened), unit: s.daysListened === 1 ? "day" : "days", caption: `out of ${s.daysInPeriod}` },
      headline: choose(ctx, "daysListened", ["Days with music", "Hardly a quiet day", "Music, day after day"]),
      aria: `You listened on ${s.daysListened} of ${s.daysInPeriod} days.`,
    });

  if (ELIGIBLE.streak(s) && s.longestStreak)
    add({
      kind: "streak",
      data: { shape: "number", value: s.longestStreak.days, display: fmtInt(s.longestStreak.days), unit: "days in a row", caption: `${formatDay(s.longestStreak.from, false)} – ${formatDay(s.longestStreak.to, false)}` },
      headline: choose(ctx, "streak", ["Your longest streak", "Not a day off", "On a roll"]),
      aria: `Your longest streak was ${s.longestStreak.days} days in a row.`,
    });

  if (ELIGIBLE.busiestDay(s) && s.busiestDay)
    add({
      kind: "busiestDay",
      data: { shape: "number", value: s.busiestDay.plays, display: fmtInt(s.busiestDay.plays), unit: "plays in one day", caption: `${WEEKDAYS[new Date(Date.UTC(1970, 0, 1 + s.busiestDay.day)).getUTCDay()]}, ${formatDay(s.busiestDay.day, false)}` },
      headline: choose(ctx, "busiestDay", ["Your busiest day", "One very musical day", "That day you didn't stop"]),
      aria: `Your busiest day was ${formatDay(s.busiestDay.day)} with ${plural(s.busiestDay.plays, "play")}.`,
    });

  if (ELIGIBLE.hours(s) && s.byHour) {
    const peak = s.byHour.indexOf(Math.max(...s.byHour));
    add({
      kind: "hours",
      data: { shape: "series", values: s.byHour, labels: s.byHour.map((_, h) => HOURS_LABEL(h)), highlight: peak, unit: "plays" },
      headline: choose(ctx, "hours", [`Peak hour: ${HOURS_LABEL(peak)}`, "Your listening clock", "When you pressed play"]),
      aria: `You listened most around ${HOURS_LABEL(peak)}.`,
    });
  }
  if (ELIGIBLE.weekdays(s) && s.byWeekday) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const values = order.map((d) => s.byWeekday![d]);
    const peak = values.indexOf(Math.max(...values));
    add({
      kind: "weekdays",
      data: { shape: "series", values, labels: order.map((d) => WEEKDAYS[d].slice(0, 3)), highlight: peak, unit: "plays" },
      headline: choose(ctx, "weekdays", [`${WEEKDAYS[order[peak]]}s were for music`, "Your week in sound", "The loudest day of the week"]),
      aria: `Your most musical weekday was ${WEEKDAYS[order[peak]]}.`,
    });
  }
  if (ELIGIBLE.calendar(s)) {
    const busiest = s.busiestDay?.day ?? null;
    add({
      kind: "calendar",
      data: { shape: "calendar", days: s.daily.map((d) => ({ day: d.day, value: d.plays })), from: opts.periodStart, to: opts.periodStart + s.daysInPeriod - 1, highlight: busiest },
      headline: choose(ctx, "calendar", ["Every day you listened", `${ctx.label}, day by day`, "Your listening calendar"]),
      aria: `A calendar of the ${s.daysListened} days you listened.`,
    });
  }

  if (ELIGIBLE.discoveries(s) && s.discoveries)
    add({
      kind: "discoveries",
      data: { shape: "number", value: s.discoveries.tracks, display: fmtInt(s.discoveries.tracks), unit: "new songs", caption: s.discoveries.artists ? `and ${plural(s.discoveries.artists, "new artist")}` : undefined },
      alt: { shape: "rank", items: s.discoveries.top.slice(0, 5).map((x) => trackItem(x, x.plays)) },
      headline: choose(ctx, "discoveries", ["Fresh finds", "New to you", "You kept exploring"]),
      aria: `You discovered ${plural(s.discoveries.tracks, "new song")}.`,
    });

  if (s.repeatChampion)
    add({
      kind: "repeatChampion",
      data: { shape: "hero", item: trackItem(s.repeatChampion.track), kicker: "Repeat champion", stat: `${s.repeatChampion.plays}× on ${formatDay(s.repeatChampion.day, false)}` },
      headline: choose(ctx, "repeatChampion", ["Once wasn't enough", "Play it again", `${s.repeatChampion.plays} times in one day`]),
      aria: `You played ${s.repeatChampion.track.title} ${s.repeatChampion.plays} times on ${formatDay(s.repeatChampion.day)}.`,
      play: trackItem(s.repeatChampion.track).play,
    });
  if (s.obsessionWeek && s.obsessionWeek.track.key !== s.repeatChampion?.track.key)
    add({
      kind: "obsessionWeek",
      data: { shape: "hero", item: trackItem(s.obsessionWeek.track), kicker: "Obsession of the week", stat: `${s.obsessionWeek.plays} plays, week of ${formatDay(s.obsessionWeek.weekStart, false)}` },
      headline: choose(ctx, "obsessionWeek", ["That week, it was all this", "A one-song week", "Your weekly obsession"]),
      aria: `In the week of ${formatDay(s.obsessionWeek.weekStart)} you played ${s.obsessionWeek.track.title} ${s.obsessionWeek.plays} times.`,
    });
  if (ELIGIBLE.firstLast(s) && s.firstPlay && s.lastPlay)
    add({
      kind: "firstLast",
      data: { shape: "pair", left: { ...trackItem(s.firstPlay.track), valueText: "First" }, right: { ...trackItem(s.lastPlay.track), valueText: "Last" } },
      headline: choose(ctx, "firstLast", ["How it started, how it ended", "First and last", "Opening and closing tracks"]),
      aria: `Your first song ${ctx.span} was ${s.firstPlay.track.title}, your last was ${s.lastPlay.track.title}.`,
    });
  if (s.mostSkipped)
    add({
      kind: "mostSkipped",
      data: { shape: "hero", item: trackItem(s.mostSkipped.track), kicker: "Most skipped", stat: plural(s.mostSkipped.skips, "skip") },
      headline: choose(ctx, "mostSkipped", ["Not today, thanks", "The one you kept skipping", "Skip, skip, skip"]),
      aria: `Your most skipped song was ${s.mostSkipped.track.title}, skipped ${plural(s.mostSkipped.skips, "time")}.`,
    });
  if (s.artistLoyalty)
    add({
      kind: "artistLoyalty",
      data: { shape: "hero", item: { label: s.artistLoyalty.artist.name, sub: s.artistLoyalty.artist.topTrack, image: s.artistLoyalty.artist.thumbnail }, kicker: "Most loyal", stat: `${s.artistLoyalty.months} months out of 12` },
      headline: choose(ctx, "artistLoyalty", ["Always there for you", "Your constant companion", "Month after month"]),
      aria: `${s.artistLoyalty.artist.name} was with you in ${s.artistLoyalty.months} different months.`,
    });
  if (s.podcasts)
    add({
      kind: "podcasts",
      data: { shape: "number", value: minutesOf(s.podcasts.listenedMs), display: fmtInt(minutesOf(s.podcasts.listenedMs)), unit: "podcast minutes", caption: `${plural(s.podcasts.episodes, "episode")}, mostly ${s.podcasts.topShow}` },
      headline: choose(ctx, "podcasts", ["Talk to me", "Between the songs", "Your podcast time"]),
      aria: `You listened to ${plural(s.podcasts.episodes, "podcast episode")}, mostly ${s.podcasts.topShow}.`,
    });
  if (s.journey) {
    const peak = s.journey.reduce((b, m, i, arr) => (m.listenedMs > arr[b].listenedMs ? i : b), 0);
    add({
      kind: "journey",
      data: { shape: "series", values: s.journey.map((m) => minutesOf(m.listenedMs)), labels: s.journey.map((m) => MONTHS_SHORT[m.month]), highlight: peak, unit: "minutes" },
      headline: choose(ctx, "journey", ["Your year, month by month", "The shape of your year", `${MONTHS[s.journey[peak].month]} was your loudest month`]),
      sub: s.journey[peak].topArtist ? `${MONTHS[s.journey[peak].month]} belonged to ${s.journey[peak].topArtist}.` : undefined,
      aria: `Month by month, your busiest was ${MONTHS[s.journey[peak].month]}.`,
      duration: 9000,
    });
  }
  if (s.milestones.length) {
    const m = s.milestones.at(-1)!;
    add({
      kind: "milestone",
      data: { shape: "number", value: m.n, display: fmtInt(m.n), unit: "th play", caption: `"${m.track.title}" on ${formatDay(m.day, false)}` },
      headline: choose(ctx, "milestone", ["A milestone", `Play number ${fmtInt(m.n)}`, "Look how far you've come"]),
      aria: `Your ${fmtInt(m.n)}th play was ${m.track.title}.`,
    });
  }
  if (ELIGIBLE.comparison(s) && s.comparison) {
    const up = s.comparison.deltaMs > 0;
    add({
      kind: "comparison",
      data: {
        shape: "pair",
        left: { label: year ? `${ctx.period.year - 1}` : "Last month", valueText: duration(s.comparison.prevListenedMs), value: s.comparison.prevListenedMs },
        right: { label: year ? `${ctx.period.year}` : ctx.label, valueText: duration(s.listenedMs), value: s.listenedMs },
        verdict: `${up ? "+" : "−"}${Math.abs(s.comparison.deltaPct)} %`,
      },
      headline: choose(ctx, "comparison", up ? ["Turned up", "More music than before", "Louder than last time"] : ["A calmer stretch", "Quality over quantity", "A little quieter"]),
      aria: `${up ? "Up" : "Down"} ${Math.abs(s.comparison.deltaPct)} percent on the period before.`,
    });
  }
  if (ELIGIBLE.fun(s)) {
    const days = s.fun.daysNonstop;
    const fun = days >= 1
      ? { value: days, display: approx(days), unit: days < 2 ? "day nonstop" : "days nonstop", caption: `or ${approx(s.fun.flights)} long-haul flights` }
      : { value: s.fun.albumsBackToBack, display: approx(s.fun.albumsBackToBack), unit: "albums back to back", caption: `or ${approx(s.fun.flights)} long-haul flights` };
    add({
      kind: "fun",
      data: { shape: "number", ...fun },
      headline: choose(ctx, "fun", ["Put another way", "In other words", "If you played it all at once"]),
      aria: `That's ${fun.display} ${fun.unit}.`,
    });
  }
  add({
    kind: "persona",
    data: { shape: "text", big: s.persona.name, lines: [s.persona.line] },
    headline: choose(ctx, "persona", ["Your listening persona", "You, as a listener", "Who you were, musically"]),
    aria: `Your listening persona: ${s.persona.name}. ${s.persona.line}`,
    duration: 7500,
  });
  if (year)
    add({
      kind: "finale",
      data: { shape: "text", big: ctx.label, lines: [] },
      headline: "Your year at a glance",
      aria: `Your ${ctx.label} at a glance: ${fmtInt(min)} minutes, top artist ${a?.name ?? "none"}, top song ${t?.title ?? "none"}, persona ${s.persona.name}.`,
      duration: 14_000,
    });
  else
    add({
      kind: "outro",
      data: { shape: "text", big: "Thanks for listening", lines: [`${fmtInt(min)} minutes`, a ? `Top artist: ${a.name}` : "", t ? `Top song: ${t.title}` : ""].filter(Boolean) },
      headline: choose(ctx, "outro", ["That was " + ctx.label, "See you next month", "Until next time"]),
      aria: `That was your ${ctx.label}. ${fmtInt(min)} minutes of music.`,
      duration: 9000,
    });
  return out;
}
