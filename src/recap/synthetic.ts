// A deterministic, made-up listening history (invented artists and songs, no real data) for tests, the dev
// toolkit's time travel and the style gallery. Same seed, same history.
import { dayFromYmd, startOfDay } from "./days";
import type { PlayEntry } from "./playLog";
import { seeded, type Rng } from "./random";

const WORDS_A = ["Glass", "Paper", "Neon", "Velvet", "Silver", "Hollow", "Golden", "Quiet", "Electric", "Lunar", "Copper", "Wild", "Midnight", "Ocean", "Amber", "Static"];
const WORDS_B = ["River", "Hearts", "Signals", "Garden", "Motel", "Skyline", "Echoes", "Parade", "Tides", "Engines", "Lanterns", "Fever", "Satellites", "Harbor", "Machines", "Weather"];
const BANDS = ["The Lumen Twins", "Arcadia Drive", "Mira Solace", "Kite Republic", "Northbound Echo", "Velma & the Static", "Juniper Hollow", "Cosmo Varga", "Saltwater Choir", "Pale Orbit", "Ruby Fontaine", "Hex Garden", "Tamsin Rowe", "Low Meridian", "Orchid Lane", "The Paper Kites Club", "Nova Haze", "Bramble Youth", "Ivo Marek", "Delta Bloom"];

interface Song { videoId: string; title: string; artist: number; album: number; durationMs: number; weight: number; debut: number }

function makeLibrary(rng: Rng): Song[] {
  const songs: Song[] = [];
  for (let a = 0; a < BANDS.length; a++) {
    const n = 4 + Math.floor(rng() * 8);
    const pop = 1 / (a + 1.5);
    for (let i = 0; i < n; i++) {
      const title = `${WORDS_A[Math.floor(rng() * WORDS_A.length)]} ${WORDS_B[Math.floor(rng() * WORDS_B.length)]}`;
      songs.push({
        videoId: `syn${a.toString(36)}${i.toString(36)}${Math.floor(rng() * 1e6).toString(36)}`.padEnd(11, "x").slice(0, 11),
        title,
        artist: a,
        album: Math.floor(i / 4),
        durationMs: 150_000 + Math.floor(rng() * 150_000),
        weight: pop * (0.3 + rng()) * (i === 0 ? 3 : 1),
        debut: rng() < 0.35 ? Math.floor(rng() * 300) : 0,
      });
    }
  }
  return songs;
}

/** A synthetic year of plays (as the local log would hold them) from Jan 1 of `year` up to `untilDay` (inclusive). */
export function syntheticLog(year: number, untilDay = dayFromYmd(year, 11, 31), seed = 7): PlayEntry[] {
  const rng = seeded(seed);
  const songs = makeLibrary(rng);
  const out: PlayEntry[] = [];
  const first = dayFromYmd(year, 0, 1);
  let n = 0;
  for (let day = first; day <= untilDay; day++) {
    if (rng() < 0.18) continue; // days off
    const sessions = 1 + Math.floor(rng() * 3);
    for (let s = 0; s < sessions; s++) {
      const hour = rng() < 0.25 ? 22 + Math.floor(rng() * 3) : 7 + Math.floor(rng() * 14);
      let at = startOfDay(day) + (hour % 24) * 3_600_000 + Math.floor(rng() * 3_000_000);
      const length = 3 + Math.floor(rng() * 12);
      const pool = songs.filter((x) => x.debut <= day - first);
      const total = pool.reduce((a, x) => a + x.weight, 0);
      for (let k = 0; k < length; k++) {
        let r = rng() * total;
        const song = pool.find((x) => (r -= x.weight) <= 0) ?? pool[0];
        const skipped = rng() < 0.08;
        const listened = skipped ? 2000 + Math.floor(rng() * 6000) : Math.floor(song.durationMs * (0.85 + rng() * 0.15));
        out.push({
          id: `syn-${n++}`,
          videoId: song.videoId,
          type: "song",
          title: song.title,
          artists: [{ id: `UCsyn${song.artist}`, name: BANDS[song.artist] }],
          album: { id: `MPREsyn${song.artist}-${song.album}`, title: `${WORDS_B[(song.artist + song.album) % WORDS_B.length]} Vol. ${song.album + 1}` },
          durationMs: song.durationMs,
          startedAt: at,
          listenedMs: listened,
          completed: !skipped && listened >= song.durationMs * 0.9,
          ...(skipped ? { skipped: true } : {}),
          source: "queue",
        });
        at += listened + 1000;
      }
    }
  }
  return out;
}
