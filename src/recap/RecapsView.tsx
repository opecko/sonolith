// The Recaps page: the newest ready recap up top, the year (with the early unlock from Oct 15), every month, and a
// plain word on where the data comes from. Works signed out (local log only).
import { CalendarDays, Lock, LockOpen, Play, RefreshCw, Settings, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { confirmAction } from "../components/ConfirmDialog";
import { ErrorBox, Loading } from "../components/Status";
import { useAuth } from "../stores/auth";
import { openSettings } from "../stores/nav";
import { useToast } from "../stores/toast";
import { clockNow } from "./clock";
import { formatDay, dayOf } from "./days";
import { duration } from "./format";
import { useHistoryImport } from "./importer";
import { canUnlockEarly, periodTitle, type Availability } from "./periods";
import { loadRecaps, openRecap, recapEntries, unlockYearEarly, useRecaps, type RecapEntry } from "./store";
import { openRecapPlayer } from "./ui";

function stateLine(a: Availability): string {
  if (a.state === "locked") return `Available on ${formatDay(dayOf(a.opensAt))} · ${a.daysLeft === 1 ? "1 day" : `${a.daysLeft} days`} to go`;
  if (a.state === "notEnough") return `Not enough listening yet · ${a.plays} of ${a.needed} plays`;
  return "Ready";
}

async function open(e: RecapEntry) {
  try {
    const snap = await openRecap(e.period);
    if (snap) openRecapPlayer(snap);
    else useToast.getState().show("This recap isn't available yet");
  } catch (err) {
    useToast.getState().show(`Could not open the recap: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export default function RecapsView() {
  const loaded = useRecaps((s) => s.loaded);
  const loading = useRecaps((s) => s.loading);
  const fresh = useRecaps((s) => s.fresh);
  // Re-read the entries whenever the store changes.
  useRecaps((s) => s.frozen);
  useRecaps((s) => s.meta);
  const importing = useHistoryImport((s) => s.running);
  const importError = useHistoryImport((s) => s.error);
  const signedIn = useAuth((s) => s.status === "signedIn");
  const takeout = useRecaps((s) => s.takeout);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    loadRecaps(true).catch((e) => setError(e instanceof Error ? e : new Error(String(e))));
  }, []);

  if (error && !loaded) return <ErrorBox error={error} onRetry={() => void loadRecaps(true).then(() => setError(null), (e) => setError(e instanceof Error ? e : new Error(String(e))))} />;
  if (!loaded) return <Loading variant="list" />;

  const now = clockNow();
  const { months, years } = recapEntries(now);
  const ready = [...years, ...months].filter((e) => e.availability.state === "ready");
  const hero = ready[0];
  const year = years[0];
  const thisYear = new Date(now).getFullYear();
  const unlockable = year.availability.state === "locked" && canUnlockEarly(thisYear, now, useRecaps.getState().meta.earlyUnlock[String(thisYear)] ?? null);

  const unlock = async () => {
    const ok = await confirmAction({
      title: `Unlock ${periodTitle(year.period)} now?`,
      message: "Your yearly recap will be frozen as of now and won't include later listening. It normally unlocks on December 1.",
      confirmLabel: "Unlock now",
    });
    if (!ok || year.period.kind !== "year") return;
    await unlockYearEarly(year.period.year);
    await open({ ...year });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-4xl font-bold tracking-tight">Recaps</h1>
        {(loading || importing) && <span className="inline-flex items-center gap-2 text-sm text-[var(--c-text-muted)]"><RefreshCw size={16} className="animate-spin" aria-hidden /> Updating your history…</span>}
        <button type="button" className="chip m3-btn m3-text inline-flex items-center gap-2" onClick={() => openSettings("recaps")}>
          <Settings size={16} aria-hidden /> Recap settings
        </button>
      </div>
      <p className="mb-6 select-text text-sm text-[var(--c-text-muted)]">
        Your monthly and yearly listening, computed on your computer{signedIn || takeout ? " from your YouTube Music history and Sonolith's own listening log" : ""}. Nothing is uploaded anywhere.
        {!signedIn && (takeout ? " You're signed out, so recaps use Sonolith's listening log and the history you imported." : " You're signed out, so recaps use only Sonolith's listening log on this computer.")}
        {signedIn && importError && ` ${importError} Recaps opened now are previews from this computer's log.`}
      </p>

      {hero ? (
        <button type="button" onClick={() => void open(hero)}
          className="m3-section relative mb-8 flex w-full items-center gap-5 overflow-hidden rounded-[var(--radius)] bg-[var(--c-accent)] p-6 text-left text-[var(--c-on-accent)]">
          <Sparkles size={48} aria-hidden className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium opacity-90">{hero.period.kind === "year" ? "Your year in music" : "Your month in music"}{fresh === hero.id ? " · New" : ""}</p>
            <p className="truncate text-3xl font-bold">{periodTitle(hero.period)}</p>
            {hero.frozen && <p className="text-sm opacity-90">{duration(hero.frozen.stats.listenedMs)} · {hero.frozen.stats.topArtists[0]?.name ?? ""}</p>}
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--c-on-accent)] px-4 py-2 text-sm font-medium text-[var(--c-accent)]"><Play size={16} aria-hidden /> Play</span>
        </button>
      ) : (
        <div className="m3-section mb-8 rounded-[var(--radius)] bg-[var(--c-surface)] p-6">
          <p className="text-lg font-medium">Your first recap is on its way</p>
          <p className="mt-1 text-sm text-[var(--c-text-muted)]">Keep listening: each month's recap opens on the 1st of the next month once it has at least 20 plays.</p>
        </div>
      )}

      <h2 className="mb-3 text-xl font-bold">Year</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {years.map((e) => (
          <RecapCard key={e.id} entry={e} isNew={fresh === e.id} extra={e === year && unlockable ? (
            <button type="button" className="chip m3-btn m3-tonal mt-3 inline-flex items-center gap-2" onClick={(ev) => { ev.stopPropagation(); void unlock(); }}>
              <LockOpen size={16} aria-hidden /> Unlock now
            </button>
          ) : null} />
        ))}
      </div>

      <h2 className="mb-3 text-xl font-bold">Months</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((e) => <RecapCard key={e.id} entry={e} isNew={fresh === e.id} />)}
      </div>
    </div>
  );
}

function RecapCard({ entry, isNew, extra }: { entry: RecapEntry; isNew: boolean; extra?: React.ReactNode }) {
  const ready = entry.availability.state === "ready";
  const Icon = ready ? (entry.period.kind === "year" ? Sparkles : CalendarDays) : Lock;
  return (
    <div className="m3-section relative rounded-[var(--radius)] bg-[var(--c-surface)]">
      <button type="button" disabled={!ready} onClick={() => void open(entry)} aria-label={`${periodTitle(entry.period)}: ${stateLine(entry.availability)}`}
        className={`flex w-full items-center gap-4 rounded-[var(--radius)] p-4 text-left ${ready ? "hover:bg-[var(--c-hover)]" : "cursor-default"}`}>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${ready ? "bg-[var(--c-accent)] text-[var(--c-on-accent)]" : "bg-[var(--c-surface-2)] text-[var(--c-text-muted)]"}`}>
          <Icon size={20} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{periodTitle(entry.period)}{isNew && <span className="ml-2 rounded-full bg-[var(--c-accent)] px-2 py-0.5 text-xs text-[var(--c-on-accent)]">New</span>}</span>
          <span className="block truncate text-sm text-[var(--c-text-muted)]">{ready && entry.frozen ? `${duration(entry.frozen.stats.listenedMs)} · ${entry.frozen.stats.topArtists[0]?.name ?? ""}` : stateLine(entry.availability)}</span>
        </span>
      </button>
      {extra && <div className="px-4 pb-4">{extra}</div>}
    </div>
  );
}
