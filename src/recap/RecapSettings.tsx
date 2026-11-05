// Settings → Recaps: the local listening log, how recaps play, and the user's data (export, delete).
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { confirmAction } from "../components/ConfirmDialog";
import Switch from "../components/Switch";
import { useSettings } from "../stores/settings";
import { useToast } from "../stores/toast";
import { Segmented, SettingCard, SettingRow } from "../views/settings/kit";
import { clockNow } from "./clock";
import { useHistoryImport } from "./importer";
import type { RecapSettings as Shape } from "./settings";
import { deleteAllRecapData, deletePlayLog, exportPlayLog } from "./storage";
import { forgetRecaps } from "./store";

export default function RecapSettings() {
  const recap = useSettings((s) => s.recap);
  const saveHistory = useSettings((s) => s.saveHistory);
  const set = (patch: Partial<Shape>) => useSettings.getState().set({ recap: { ...useSettings.getState().recap, ...patch } });
  const [busy, setBusy] = useState(false);
  const toast = (msg: string, kind?: "info") => useToast.getState().show(msg, kind);

  const doExport = async () => {
    setBusy(true);
    try {
      toast(`Saved your listening log to ${await exportPlayLog(new Date(clockNow()))}`, "info");
    } catch (e) {
      toast(`Could not export the listening log: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const doDeleteLog = async () => {
    const ok = await confirmAction({
      title: "Delete listening log?",
      message: "Sonolith's own record of what you played on this computer is deleted. Recaps you already opened stay as they are; YouTube Music's history isn't touched.",
      confirmLabel: "Delete log",
      danger: true,
    });
    if (!ok) return;
    await deletePlayLog().then(() => toast("Listening log deleted", "info"), (e) => toast(`Could not delete the log: ${String(e)}`));
  };
  const doDeleteAll = async () => {
    const ok = await confirmAction({
      title: "Delete all recap data?",
      message: "The listening log, the imported history and every recap you've opened are deleted from this computer. Recaps are made again from YouTube Music's history the next time you open them.",
      confirmLabel: "Delete everything",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteAllRecapData();
      useHistoryImport.setState({ cache: null });
      forgetRecaps();
      toast("All recap data deleted", "info");
    } catch (e) {
      toast(`Could not delete recap data: ${String(e)}`);
    }
  };

  return (
    <>
      <SettingCard title="Listening log">
        <SettingRow id="recapLog" title="Keep a local listening log"
          detail={saveHistory
            ? "Sonolith notes what you play, when, and for how long, so recaps are exact. It stays on this computer and works without signing in."
            : "Off while Save listening history (Settings → Playback) is off: nothing is recorded then."}>
          <Switch on={recap.localLog} onChange={(v) => set({ localLog: v })} label="Keep a local listening log" />
        </SettingRow>
        <SettingRow id="recapExport" title="Export log" detail="Save the whole log as a JSON file in your Downloads folder.">
          <button className="chip m3-btn m3-tonal inline-flex items-center gap-2" disabled={busy} onClick={() => void doExport()}>
            <Download size={16} aria-hidden /> Export
          </button>
        </SettingRow>
      </SettingCard>
      <SettingCard title="Recaps">
        <SettingRow id="recapGames" title="Recap games" detail="Little guessing games between the cards, like guessing your top artist.">
          <Segmented value={recap.games} options={[["sometimes", "Sometimes"], ["always", "Always"], ["never", "Never"]]} onChange={(v) => set({ games: v })} label="Recap games" />
        </SettingRow>
        <SettingRow id="recapAutoAdvance" title="Auto-advance" detail="Cards move on by themselves after a few seconds. Space pauses.">
          <Switch on={recap.autoAdvance} onChange={(v) => set({ autoAdvance: v })} label="Auto-advance" />
        </SettingRow>
        <SettingRow id="recapPodcasts" title="Include podcasts" detail="Count podcast episodes in recaps that haven't been made yet.">
          <Switch on={recap.podcasts} onChange={(v) => set({ podcasts: v })} label="Include podcasts" />
        </SettingRow>
      </SettingCard>
      <SettingCard title="Your data">
        <SettingRow id="recapDeleteLog" title="Delete listening log" detail="Removes Sonolith's own record of your plays.">
          <button className="chip m3-btn m3-outlined inline-flex items-center gap-2" onClick={() => void doDeleteLog()}>
            <Trash2 size={16} aria-hidden /> Delete log
          </button>
        </SettingRow>
        <SettingRow id="recapDeleteAll" title="Delete all recap data" detail="The log, the imported history and every recap you've opened.">
          <button className="chip m3-btn m3-danger inline-flex items-center gap-2" onClick={() => void doDeleteAll()}>
            <Trash2 size={16} aria-hidden /> Delete all
          </button>
        </SettingRow>
      </SettingCard>
    </>
  );
}
