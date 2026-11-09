import { useMemo, useState } from "react";
import { Segmented } from "../views/settings/kit";
import Thumb from "../components/Thumb";
import { clockNow } from "./clock";
import { duration, fmtInt, plural } from "./format";
import { liveStats, type LiveWindow } from "./live";
import { useRecaps } from "./store";

const WINDOWS: readonly (readonly [LiveWindow, string])[] = [["today", "Today"], ["week", "7 days"], ["month", "This month"]];

/** Recaps page: how the listening is going right now, from the same plays as the recaps. */
export default function LiveStats() {
  const data = useRecaps((s) => s.data ?? s.local);
  const [w, setW] = useState<LiveWindow>("today");
  const s = useMemo(() => (data ? liveStats(data.plays, clockNow(), w) : null), [data, w]);
  if (!s) return null;
  return (
    <section className="m3-section mb-6 rounded-[var(--radius)] bg-[var(--c-surface)] p-5" aria-label="Listening right now">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Right now</h2>
        <Segmented value={w} options={WINDOWS} onChange={setW} label="Time span" />
      </div>
      {s.plays === 0 ? (
        <p className="text-sm text-[var(--c-text-muted)]">Nothing played {w === "today" ? "today" : w === "week" ? "in the last 7 days" : "this month"} yet.</p>
      ) : (
        <div className="grid select-text gap-4 sm:grid-cols-2">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <p className="type-headline-medium-em tabular-nums">{fmtInt(s.plays)}</p>
              <p className="text-sm text-[var(--c-text-muted)]">{s.plays === 1 ? "play" : "plays"}</p>
            </div>
            <div>
              <p className="type-headline-medium-em tabular-nums">{duration(s.listenedMs)}</p>
              <p className="text-sm text-[var(--c-text-muted)]">listened</p>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            {s.topSong && (
              <div className="flex min-w-0 items-center gap-3">
                <Thumb src={s.topSong.thumbnail} px={48} className="m3-art h-12 w-12 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-[var(--c-text-muted)]">Most played song · {plural(s.topSong.plays, "play")}</p>
                  <p className="truncate font-medium">{s.topSong.title}</p>
                  <p className="truncate text-sm text-[var(--c-text-muted)]">{s.topSong.artist}</p>
                </div>
              </div>
            )}
            {s.topArtist && (
              <div className="min-w-0">
                <p className="text-xs text-[var(--c-text-muted)]">Most played artist · {plural(s.topArtist.plays, "play")}</p>
                <p className="truncate font-medium">{s.topArtist.name}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
