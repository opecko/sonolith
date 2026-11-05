// Dev toolkit → Recaps: time travel, a synthetic year, open any period (never saved), force games or a style, the
// style gallery, and resetting frozen snapshots.
import { Clock, GalleryHorizontal, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { confirmAction } from "../components/ConfirmDialog";
import Switch from "../components/Switch";
import { clockNow, clockTraveling, setClockTo } from "../recap/clock";
import { dayFromYmd, MONTHS } from "../recap/days";
import { mergePlays } from "../recap/merge";
import { cutoffOf, periodEnd, type Period } from "../recap/periods";
import { buildSnapshot } from "../recap/snapshot";
import { deleteJson, listJson } from "../recap/storage";
import { forgetSnapshots, loadRecaps, resetUnlocks, useRecaps } from "../recap/store";
import { STYLES, type StyleId } from "../recap/styles";
import { syntheticLog } from "../recap/synthetic";
import { openRecapPlayer, useRecapUi } from "../recap/ui";
import { useSettings } from "../stores/settings";
import { useToast } from "../stores/toast";
import { galleryDeck } from "./recapGallery";

const pad = (n: number) => String(n).padStart(2, "0");
const toInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function RecapDev({ onClose }: { onClose: () => void }) {
  const [when, setWhen] = useState(toInput(clockNow()));
  const [traveling, setTraveling] = useState(clockTraveling());
  const [synthetic, setSynthetic] = useState(true);
  const [kind, setKind] = useState<"month" | "year">("month");
  const now = new Date(clockNow());
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState((now.getMonth() + 11) % 12);
  const [forceGames, setForceGames] = useState(false);
  const [forceStyle, setForceStyle] = useState<StyleId | "">("");
  const field = "h-10 rounded-[var(--m3-corner-sm)] bg-[var(--m3-surface-container-high)] px-2 type-body-medium";

  const travel = (ms: number | null) => {
    setClockTo(ms);
    setTraveling(ms !== null);
    void loadRecaps(false);
  };

  /** A snapshot of the chosen period, made now and never saved (a frozen one on disk isn't touched). */
  const snapshotFor = (p: Period, useSynthetic: boolean) => {
    const data = useSynthetic ? mergePlays(syntheticLog(p.year, dayFromYmd(p.year, 11, 31)), []) : useRecaps.getState().data;
    if (!data) return null;
    const cutoff = cutoffOf(p, Math.max(clockNow(), periodEnd(p)), useRecaps.getState().meta.earlyUnlock[String(p.year)] ?? null)!;
    return buildSnapshot(p, data, cutoff, clockNow(), { frozen: false, podcasts: useSettings.getState().recap.podcasts, youtube: !useSynthetic });
  };

  const openPeriod = async () => {
    if (!synthetic && !useRecaps.getState().loaded) await loadRecaps(true);
    const p: Period = kind === "year" ? { kind, year } : { kind, year, month };
    const snap = snapshotFor(p, synthetic);
    if (!snap) return useToast.getState().show("No data loaded");
    onClose();
    openRecapPlayer(snap, { fresh: true, forceGames, forceStyle: forceStyle || null });
  };

  const gallery = () => {
    const snap = snapshotFor({ kind: "year", year }, true)!;
    onClose();
    useRecapUi.setState({ open: { snapshot: snap, seed: 1, start: 0, deck: galleryDeck(snap) } });
  };

  const reset = async () => {
    const ok = await confirmAction({ title: "Reset recaps?", message: "Deletes every frozen recap on disk and forgets early unlocks (the year locks again) and which recaps were seen. They're made again from the data the next time they open. The log, the imported history and saved playlists stay.", confirmLabel: "Reset", danger: true });
    if (!ok) return;
    for (const n of await listJson("snapshots")) await deleteJson(n);
    forgetSnapshots();
    await resetUnlocks();
    await loadRecaps(false);
    useToast.getState().show("Recaps reset: snapshots and early unlocks", "info");
  };

  return (
    <>
      <p className="type-body-medium">Time travel{traveling && <span className="text-[var(--m3-primary)]"> · on</span>}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={field} aria-label="Pretend it's" />
        <button className="m3-btn m3-tonal h-10" onClick={() => travel(new Date(when).getTime())}><Clock size={16} aria-hidden /> Go</button>
        <button className="m3-btn m3-text h-10" onClick={() => { travel(null); setWhen(toInput(Date.now())); }}>Back to now</button>
      </div>
      <p className="type-body-small text-[var(--m3-on-surface-variant)]">Moves Recaps' clock only (unlocks, the Recaps page, snapshots made while it's on); playback and the log keep real time.</p>

      <p className="type-body-medium mt-2">Open a recap (not saved)</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className={field} value={kind} onChange={(e) => setKind(e.target.value as "month" | "year")} aria-label="Period kind">
          <option value="month">Month</option><option value="year">Year</option>
        </select>
        {kind === "month" && (
          <select className={field} value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        )}
        <input type="number" className={`${field} w-24`} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" />
      </div>
      <div className="flex items-center justify-between"><span className="type-body-medium">Synthetic history (a full made-up year)</span><Switch on={synthetic} onChange={setSynthetic} label="Synthetic history" /></div>
      <div className="flex items-center justify-between"><span className="type-body-medium">Force games</span><Switch on={forceGames} onChange={setForceGames} label="Force games" /></div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-body-medium">Force style</span>
        <select className={field} value={forceStyle} onChange={(e) => setForceStyle(e.target.value as StyleId | "")} aria-label="Force style">
          <option value="">Random</option>
          {STYLES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="m3-btn m3-tonal h-10" onClick={() => void openPeriod()}><Play size={16} aria-hidden /> Open recap</button>
        <button className="m3-btn m3-tonal h-10" onClick={gallery}><GalleryHorizontal size={16} aria-hidden /> Style gallery</button>
        <button className="m3-btn m3-outlined h-10" onClick={() => void reset()}><RotateCcw size={16} aria-hidden /> Reset snapshots and unlocks</button>
      </div>
    </>
  );
}
