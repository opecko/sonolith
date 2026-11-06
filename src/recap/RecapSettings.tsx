// Settings → Recaps: the local listening log, how recaps play, and the user's data (export, delete).
import { invoke } from "@tauri-apps/api/core";
import { Check, Download, ExternalLink, FileUp, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { confirmAction } from "../components/ConfirmDialog";
import Switch from "../components/Switch";
import { useNav } from "../stores/nav";
import { useSettings } from "../stores/settings";
import { useToast } from "../stores/toast";
import { SettingCard, SettingRow } from "../views/settings/kit";
import { clockNow } from "./clock";
import { stopHistoryImport, useHistoryImport } from "./importer";
import type { RecapSettings as Shape } from "./settings";
import { deleteAllRecapData, deletePlayLog, exportPlayLog } from "./storage";
import { formatDay, dayOf } from "./days";
import { fmtInt } from "./format";
import { forgetRecaps, importTakeout, loadRecaps, removeTakeout, useRecaps } from "./store";

export default function RecapSettings() {
  const recap = useSettings((s) => s.recap);
  const saveHistory = useSettings((s) => s.saveHistory);
  const set = (patch: Partial<Shape>) => useSettings.getState().set({ recap: { ...useSettings.getState().recap, ...patch } });
  const [busy, setBusy] = useState(false);
  const takeout = useRecaps((s) => s.takeout);
  const loaded = useRecaps((s) => s.loaded);
  useEffect(() => {
    if (!loaded) void loadRecaps(false).catch(() => {});
  }, []);
  const file = useRef<HTMLInputElement>(null);
  const toast = (msg: string, kind?: "info") => useToast.getState().show(msg, kind);

  const doExport = async () => {
    setBusy(true);
    try {
      toast(`Saved a copy to ${await exportPlayLog(new Date(clockNow()))}`, "info");
    } catch (e) {
      toast(`Could not export the listening log: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const doImport = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await importTakeout(await f.text());
      if (r.ok)
        toast(r.added
          ? `Added ${fmtInt(r.added)} plays from ${formatDay(dayOf(r.from))} to ${formatDay(dayOf(r.to))}`
          : "Nothing new: that file was added already", "info");
      else
        toast(r.reason === "html"
          ? "That's the web page version. Export again with history set to JSON (step 3)"
          : r.reason === "empty" ? "That file has no YouTube Music plays in it" : "That's not the right file: pick watch-history.json");
    } catch (e) {
      toast(`Could not import the history: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };
  const doRemoveTakeout = async () => {
    const ok = await confirmAction({
      title: "Remove the history from Google?",
      message: "The plays added from your Google file are removed from this computer. Recaps you already saw stay as they are.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) await removeTakeout().then(() => toast("Imported history removed", "info"), (e) => toast(`Could not remove it: ${String(e)}`));
  };
  const doDeleteLog = async () => {
    const ok = await confirmAction({
      title: "Forget what you played?",
      message: "Sonolith's own list of what you played on this computer is deleted. Recaps you already saw stay, and YouTube Music's history isn't touched.",
      confirmLabel: "Forget",
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePlayLog();
      // Recaps made from now on must not use the plays still loaded in memory.
      if (useRecaps.getState().loaded) await loadRecaps(false, true);
      toast("Listening log deleted", "info");
    } catch (e) {
      toast(`Could not delete the log: ${String(e)}`);
    }
  };
  const doDeleteAll = async () => {
    const ok = await confirmAction({
      title: "Delete everything?",
      message: "The listening log, the imported YouTube and Takeout history and every recap you've opened are deleted from this computer. Recaps are made again from YouTube Music's history the next time you open them.",
      confirmLabel: "Delete everything",
      danger: true,
    });
    if (!ok) return;
    try {
      // A history import still running would write its file back after the deletion.
      await stopHistoryImport();
      await deleteAllRecapData();
      useHistoryImport.setState({ cache: null });
      forgetRecaps();
      toast("All recap data deleted", "info");
    } catch (e) {
      toast(`Could not delete recap data: ${String(e)}`);
    }
  };

  const step = "flex gap-3";
  const num = "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--c-surface-2)] text-xs font-semibold";
  return (
    <>
      <SettingCard>
        <SettingRow id="recapOpen" title="Your month and year in music"
          detail="A short story about what you listened to: your top artists and songs, when you listen, a few little games. A new one every month, and a big one for the year.">
          <button className="chip m3-btn m3-filled inline-flex items-center gap-2" onClick={() => useNav.getState().go({ name: "recaps" })}>
            <Sparkles size={16} aria-hidden /> Open Recaps
          </button>
        </SettingRow>
      </SettingCard>

      <SettingCard title="While a recap plays">
        <SettingRow id="recapMusic" title="Play my top songs" detail="Your favorite songs play in the background. Whatever was playing pauses and comes back after.">
          <Switch on={recap.music} onChange={(v) => set({ music: v })} label="Play my top songs" />
        </SettingRow>
        <SettingRow id="recapAutoAdvance" title="Move on by itself" detail="Cards turn on their own after a few seconds. Off: click or press → to go on. Space pauses either way.">
          <Switch on={recap.autoAdvance} onChange={(v) => set({ autoAdvance: v })} label="Move on by itself" />
        </SettingRow>
        <SettingRow id="recapPodcasts" title="Count podcasts" detail="Include podcast episodes in your next recaps (ones you already opened stay as they are).">
          <Switch on={recap.podcasts} onChange={(v) => set({ podcasts: v })} label="Count podcasts" />
        </SettingRow>
      </SettingCard>

      <SettingCard title="What recaps are made from">
        <SettingRow id="recapLog" title="Remember what I play"
          detail={saveHistory
            ? "Needed for complete recaps: Sonolith notes each song you play and for how long. It stays on this computer, and works without signing in."
            : <span className="text-[var(--c-error)]">Off, because "Save listening history" is off. Recaps then only show what YouTube Music remembers.</span>}>
          {saveHistory ? (
            <Switch on={recap.localLog} onChange={(v) => set({ localLog: v })} label="Remember what I play" />
          ) : (
            <button className="chip m3-btn m3-tonal" onClick={() => useSettings.getState().set({ saveHistory: true })}>Turn on</button>
          )}
        </SettingRow>
        <SettingRow id="recapTakeout" title="Add older listening (optional)" stacked
          detail="Recaps only know what you play in Sonolith from now on, plus your last 200 songs from YouTube Music. To add everything from before (and from your phone), get a copy of your history from Google once:">
          <ol className="flex flex-col gap-2 text-sm">
            <li className={step}><span className={num}>1</span><span className="min-w-0 flex-1">
              <button className="chip m3-btn m3-tonal inline-flex items-center gap-2" onClick={() => void invoke("open_credit", { name: "google-takeout" }).catch(() => {})}>
                <ExternalLink size={16} aria-hidden /> Open Google Takeout
              </button>
            </span></li>
            <li className={step}><span className={num}>2</span><span className="min-w-0 flex-1">Click <b>Deselect all</b>, then tick only <b>YouTube and YouTube Music</b>.</span></li>
            <li className={step}><span className={num}>3</span><span className="min-w-0 flex-1">In <b>All YouTube data included</b>, keep only <b>history</b>. In <b>Multiple formats</b>, set history to <b>JSON</b>.</span></li>
            <li className={step}><span className={num}>4</span><span className="min-w-0 flex-1">Create the export. Google emails you when it's ready (minutes, sometimes hours). Download and unzip it.</span></li>
            <li className={step}><span className={num}>5</span><span className="min-w-0 flex-1">
              Pick the file <b>watch-history.json</b> from it:
              <span className="mt-2 flex flex-wrap gap-2">
                <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void doImport(e.target.files?.[0])} />
                <button className="chip m3-btn m3-tonal inline-flex items-center gap-2" disabled={busy} onClick={() => file.current?.click()}>
                  <FileUp size={16} aria-hidden /> {busy ? "Adding…" : "Choose the file"}
                </button>
                {takeout > 0 && (
                  <button className="chip m3-btn m3-text inline-flex items-center gap-2" disabled={busy} onClick={() => void doRemoveTakeout()}>
                    <Trash2 size={16} aria-hidden /> Remove it again
                  </button>
                )}
              </span>
            </span></li>
          </ol>
          {takeout > 0 && <p className="mt-3 inline-flex items-center gap-2 text-sm"><Check size={16} aria-hidden className="text-[var(--c-accent)]" /> Added {fmtInt(takeout)} plays from Google. Recaps you open from now on include them.</p>}
        </SettingRow>
      </SettingCard>

      <SettingCard title="Your data">
        <SettingRow id="recapExport" title="Save a copy" detail="Download everything Sonolith remembered as a file in your Downloads folder.">
          <button className="chip m3-btn m3-tonal inline-flex items-center gap-2" disabled={busy} onClick={() => void doExport()}>
            <Download size={16} aria-hidden /> Save a copy
          </button>
        </SettingRow>
        <SettingRow id="recapDeleteLog" title="Forget what I played" detail="Deletes Sonolith's own list of your plays. Recaps you already saw stay.">
          <button className="chip m3-btn m3-outlined inline-flex items-center gap-2" onClick={() => void doDeleteLog()}>
            <Trash2 size={16} aria-hidden /> Forget
          </button>
        </SettingRow>
        <SettingRow id="recapDeleteAll" title="Delete everything" detail="All of the above, the history added from Google and every recap you've seen. Can't be undone.">
          <button className="chip m3-btn m3-danger inline-flex items-center gap-2" onClick={() => void doDeleteAll()}>
            <Trash2 size={16} aria-hidden /> Delete everything
          </button>
        </SettingRow>
      </SettingCard>
    </>
  );
}
