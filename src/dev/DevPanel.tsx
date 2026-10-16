import { getVersion } from "@tauri-apps/api/app";
import { Download, Hand, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { confirmAction } from "../components/ConfirmDialog";
import Switch from "../components/Switch";
import { previewOnboarding } from "../onboarding/store";
import { flush, setAppearance, useSettings } from "../stores/settings";
import { useUpdate, type UpdateInfo } from "../stores/update";
import { NOW_PLAYING_LAYOUTS, UI_STYLES } from "../theme/appearance";
import { WHATS_NEW } from "../whatsNew/entries";
import { useWhatsNew } from "../whatsNew/store";
import { useDevFlags } from "./flags";

type Flavor = "github" | "installer" | "aur";

/** A made-up newer release (next major) that drives the real update chip and dialog; marked simulated. */
function fakeUpdate(current: string, flavor: Flavor): UpdateInfo {
  const major = Number(current.split(".")[0]) || 0;
  const latest = `${major + 1}.0.0`;
  return {
    current,
    latest,
    newer: true,
    notes: `## ytdesk ${latest}\n\n**Simulated update** from the dev toolkit. Nothing is downloaded, installed or opened.\n\n- A highlight\n- Another one`,
    url: "",
    installer: flavor === "installer",
    aur: flavor === "aur" ? { package: "ytdesk-bin", helpers: ["yay", "paru"] } : null,
    simulated: true,
  };
}

/**
 * Clears the onboarding and What's new flags, then reloads with a one-shot marker that makes the first-run check
 * see no other prior data (settings, cookie and files stay), so the real detection path runs as on a fresh install.
 */
async function simulateFreshInstall() {
  const ok = await confirmAction({
    title: "Simulate a fresh install?",
    message: "Clears onboardingCompleted and lastSeenVersion and reloads the app. The first-run check then ignores your stored data and sign-in once; your settings, queue and sign-in stay.",
    confirmLabel: "Clear and reload",
  });
  if (!ok) return;
  useSettings.getState().set({ onboardingCompleted: false, lastSeenVersion: null });
  flush();
  // Without the flag, as on a fresh install: the stored settings keep everything else.
  const stored = JSON.parse(localStorage.getItem("settings") ?? "{}");
  delete stored.onboardingCompleted;
  delete stored.lastSeenVersion;
  localStorage.setItem("settings", JSON.stringify(stored));
  localStorage.setItem("dev:simulateFresh", "1");
  location.reload();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--m3-corner-lg)] bg-[var(--m3-surface-container)] p-4">
      <h3 className="type-title-small-em text-[var(--m3-on-surface-variant)]">{title}</h3>
      {children}
    </section>
  );
}

/** Dev panel: fake update, What's new for any entry, lastSeenVersion reset, onboarding, look toggles, settings JSON. */
export default function DevPanel({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const { uiStyle, nowPlayingLayout, animations } = settings.appearance;
  const [version, setVersion] = useState("0.0.0");
  const [flavor, setFlavor] = useState<Flavor>("github");
  const noHistory = useDevFlags((s) => s.noHistory);
  const setNoHistory = useDevFlags((s) => s.setNoHistory);
  useEffect(() => {
    getVersion().then(setVersion, () => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const { set: _set, ...json } = settings;
  const seg = "m3-seg";
  return (
    <div role="dialog" aria-label="Developer tools"
      className="fixed bottom-[84px] right-3 top-16 z-50 flex w-[380px] flex-col overflow-hidden rounded-[var(--m3-corner-xl)] bg-[var(--m3-surface-container-high)] text-[var(--m3-on-surface)] shadow-[0_8px_32px_color-mix(in_srgb,var(--m3-scrim)_40%,transparent)]">
      <header className="flex items-center justify-between px-5 pb-2 pt-4">
        <div>
          <h2 className="type-title-large-em">Developer tools</h2>
          <p className="type-body-small text-[var(--m3-on-surface-variant)]">Dev builds only · app {version}</p>
        </div>
        <button className="icon-btn h-10 w-10" onClick={onClose} aria-label="Close developer tools"><X size={20} /></button>
      </header>
      <div className="scroll-y flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
        <Section title="Updates">
          <div className="m3-segmented flex" role="group" aria-label="Update flavor">
            {(["github", "installer", "aur"] as const).map((f) => (
              <button key={f} className={seg} aria-pressed={flavor === f} onClick={() => setFlavor(f)}>{f === "github" ? "GitHub" : f === "installer" ? "Installer" : "AUR"}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="m3-btn m3-filled h-10" onClick={() => useUpdate.setState({ available: fakeUpdate(version, flavor), install: { status: "idle" }, dialogOpen: true })}>
              <Download size={18} aria-hidden /> Simulate update available
            </button>
            <button className="m3-btn m3-text h-10" onClick={() => useUpdate.setState({ available: null, dialogOpen: false, install: { status: "idle" } })}>Clear</button>
          </div>
        </Section>
        <Section title="What's new">
          <div className="flex flex-wrap gap-2">
            {WHATS_NEW.map((e) => (
              <button key={e.version} className="m3-btn m3-tonal h-10" onClick={() => useWhatsNew.getState().show(e)}>
                <Sparkles size={18} aria-hidden /> Show {e.version}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="type-body-medium">lastSeenVersion: <code className="font-mono">{String(settings.lastSeenVersion)}</code></p>
            <button className="m3-btn m3-outlined h-10" onClick={() => settings.set({ lastSeenVersion: null })}><RotateCcw size={16} aria-hidden /> Reset</button>
          </div>
        </Section>
        <Section title="Onboarding">
          <p className="type-body-medium">onboardingCompleted: <code className="font-mono">{String(settings.onboardingCompleted)}</code></p>
          <div className="flex flex-wrap gap-2">
            <button className="m3-btn m3-tonal h-10" onClick={() => { onClose(); previewOnboarding(); }}><Hand size={18} aria-hidden /> Show onboarding</button>
            <button className="m3-btn m3-outlined h-10" onClick={() => void simulateFreshInstall()}><RotateCcw size={16} aria-hidden /> Simulate fresh install</button>
          </div>
          <p className="type-body-small text-[var(--m3-on-surface-variant)]">Show: a preview, no flags change and the look comes back when it closes. Simulate: the real first-run check on a reload.</p>
        </Section>
        <Section title="Look">
          <div className="m3-segmented flex" role="group" aria-label="Style">
            {UI_STYLES.map((s) => <button key={s} className={seg} aria-pressed={uiStyle === s} onClick={() => setAppearance({ uiStyle: s })}>{s === "m3" ? "M3" : "Classic"}</button>)}
          </div>
          <div className="m3-segmented flex" role="group" aria-label="Now Playing layout">
            {NOW_PLAYING_LAYOUTS.map((l) => <button key={l} className={`${seg} capitalize`} aria-pressed={nowPlayingLayout === l} onClick={() => setAppearance({ nowPlayingLayout: l })}>{l}</button>)}
          </div>
          <div className="flex items-center justify-between">
            <span className="type-body-medium">Animations</span>
            <Switch on={animations} onChange={(on) => setAppearance({ animations: on })} label="Animations" />
          </div>
        </Section>
        <Section title="Playback">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="type-body-medium">Don't save played tracks to history</p>
              <p className="type-body-small text-[var(--m3-on-surface-variant)]">No YouTube Music history pings while on. Not saved: off again after a restart.</p>
            </div>
            <Switch on={noHistory} onChange={setNoHistory} label="Don't save played tracks to history" />
          </div>
        </Section>
        <Section title="Settings JSON">
          <pre className="max-h-72 select-text overflow-auto whitespace-pre-wrap break-all rounded-[var(--m3-corner-sm)] bg-[var(--m3-surface-container-lowest)] p-3 font-[ui-monospace,monospace] text-xs">
            {JSON.stringify(json, null, 2)}
          </pre>
        </Section>
      </div>
    </div>
  );
}
