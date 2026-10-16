import { ChevronDown, Download, ExternalLink, Hand, RefreshCw, ScrollText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ytdlpInstall, ytdlpSetPath, ytdlpStatus, ytdlpUpdate } from "../api/ytdlp";
import { invoke } from "@tauri-apps/api/core";
import AppearanceSettings from "../components/appearance/AppearanceSettings";
import AutoplayToggle from "../components/AutoplayToggle";
import ChangelogDialog from "../components/ChangelogDialog";
import Switch from "../components/Switch";
import { ErrorBox, Loading } from "../components/Status";
import { useAsync } from "../hooks/useData";
import { rerunOnboarding } from "../onboarding/store";
import { useSettings } from "../stores/settings";
import { useUpdate } from "../stores/update";
// Shipped with the font, as the OFL asks.
import fontLicense from "../assets/fonts/GoogleSansFlex-OFL.txt?raw";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-2 text-sm">
      <span className="w-32 shrink-0 text-[var(--c-text-muted)]">{label}</span>
      <span className="min-w-0 flex-1 select-text break-all">{children}</span>
    </div>
  );
}

function FlagSetting({ id, get, set, title, detail }: { id: string; get: string; set: string; title: string; detail: string }) {
  const flag = useAsync(id, () => invoke<boolean>(get));
  const [busy, setBusy] = useState(false);
  const change = async (enabled: boolean) => {
    setBusy(true);
    try {
      await invoke(set, { enabled });
    } finally {
      setBusy(false);
      flag.reload();
    }
  };
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm">{title}</p>
        <p className="text-sm text-[var(--c-text-muted)]">{detail}</p>
      </div>
      <Switch on={flag.data ?? true} onChange={(v) => void change(v)} label={title} disabled={busy || flag.data === undefined} />
    </div>
  );
}

/** yt-dlp fallback settings; mounted only when the Advanced section is open, so its status isn't probed otherwise. */
function YtdlpSettings() {
  const status = useAsync("ytdlp-status", ytdlpStatus);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setNote(null);
    try {
      const r = await fn();
      setNote({ ok: true, text: typeof r === "string" && r ? r : `${label}: done` });
    } catch (e) {
      setNote({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
      status.reload();
    }
  };

  const s = status.data;
  return (
    <div>
      <h3 className="mb-1 text-base font-semibold">yt-dlp</h3>
      <p className="mb-4 text-sm text-[var(--c-text-muted)]">
        Fallback for resolving audio streams. The app keeps its own up-to-date copy unless you set a path.
      </p>
      {status.error ? <ErrorBox error={status.error} onRetry={status.reload} /> : !s ? <Loading variant="list" /> : (
        <>
          <Row label="Binary">{s.path}{s.managed && <span className="ml-2 text-xs text-[var(--c-text-subtle)]">(managed)</span>}</Row>
          <Row label="Version">{s.version ?? <span className="text-[var(--c-error)]">not runnable</span>}</Row>
          <Row label="JS runtime">{s.jsRuntime ?? <span className="text-[var(--c-error)]">none found: install deno (recommended) or node</span>}</Row>
        </>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="chip inline-flex items-center gap-2" disabled={!!busy} onClick={() => run("Install", ytdlpInstall)}>
          <Download size={16} aria-hidden /> {busy === "Install" ? "Downloading…" : "Install / reinstall"}
        </button>
        <button className="chip inline-flex items-center gap-2" disabled={!!busy || !s?.managed} onClick={() => run("Update", ytdlpUpdate)}>
          <RefreshCw size={16} aria-hidden className={busy === "Update" ? "animate-spin" : ""} /> Update (yt-dlp -U)
        </button>
      </div>
      <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); void run("Save path", () => ytdlpSetPath(path?.trim() || null)); }}>
        <input
          value={path ?? s?.configured ?? ""}
          onChange={(e) => setPath(e.target.value)}
          placeholder="Custom yt-dlp path (empty = managed copy)"
          aria-label="Custom yt-dlp path"
          className="m3-field h-10 min-w-0 flex-1 select-text rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-2)] px-4 text-sm outline-none focus:border-[var(--c-text-subtle)]"
        />
        <button className="chip h-10" disabled={!!busy}>Save</button>
      </form>
      {note && <p className={`mt-3 select-text whitespace-pre-wrap text-xs ${note.ok ? "text-[var(--c-text-muted)]" : "text-[var(--c-error)]"}`}>{note.text}</p>}
    </div>
  );
}

function HistorySetting() {
  const { saveHistory, set } = useSettings();
  return (
    <div className="mt-4 flex items-center justify-between gap-4">
      <p className="text-sm text-[var(--c-text-muted)]">Save played songs to your YouTube Music history (also improves recommendations).</p>
      <Switch on={saveHistory} onChange={(v) => set({ saveHistory: v })} label="Save listening history" />
    </div>
  );
}

function DiscordSettings() {
  const { discordRpc, discordButton, discordPodcasts, set } = useSettings();
  return (
    <section className="m3-section mb-6 rounded-lg bg-[var(--c-surface)] p-6">
      <h2 className="mb-1 text-lg font-semibold">Discord</h2>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm">Rich Presence</p>
          <p className="text-sm text-[var(--c-text-muted)]">Show what you're listening to on your Discord profile: song, artist, album, cover and progress.</p>
        </div>
        <Switch on={discordRpc} onChange={(v) => set({ discordRpc: v })} label="Discord Rich Presence" />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm">"Listen on YouTube Music" button</p>
          <p className="text-sm text-[var(--c-text-muted)]">Lets others open the song you're playing.</p>
        </div>
        <Switch on={discordButton} onChange={(v) => set({ discordButton: v })} label="Listen on YouTube Music button" disabled={!discordRpc} />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm">Show podcasts</p>
          <p className="text-sm text-[var(--c-text-muted)]">Also show podcast episodes you're listening to. Off by default.</p>
        </div>
        <Switch on={discordPodcasts} onChange={(v) => set({ discordPodcasts: v })} label="Show podcasts on Discord" disabled={!discordRpc} />
      </div>
    </section>
  );
}

function UpdateSettings() {
  const { updateCheck, set } = useSettings();
  const [state, setState] = useState<{ busy: boolean; text?: string; error?: boolean }>({ busy: false });
  const checkNow = async () => {
    setState({ busy: true });
    try {
      const info = await useUpdate.getState().check();
      if (info.newer) {
        setState({ busy: false });
        useUpdate.getState().setDialogOpen(true);
      } else setState({ busy: false, text: `You're up to date (version ${info.current}).` });
    } catch (e) {
      setState({ busy: false, error: true, text: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <section className="m3-section mb-6 rounded-lg bg-[var(--c-surface)] p-6">
      <h2 className="mb-1 text-lg font-semibold">Updates</h2>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm">Check for updates on startup</p>
          <p className="text-sm text-[var(--c-text-muted)]">Looks for a new ytdesk release on GitHub when the app starts.</p>
        </div>
        <Switch on={updateCheck} onChange={(v) => set({ updateCheck: v })} label="Check for updates on startup" />
      </div>
      <div className="mt-4 flex items-center gap-4">
        <button onClick={() => void checkNow()} disabled={state.busy}
          className="m3-btn m3-tonal flex h-9 shrink-0 items-center gap-2 rounded-full bg-[var(--c-hover)] px-4 text-sm font-medium hover:bg-[var(--c-active)] disabled:opacity-60">
          <RefreshCw size={16} className={state.busy ? "animate-spin" : ""} aria-hidden /> Check now
        </button>
        {state.text && <p className={`select-text text-sm ${state.error ? "text-[var(--c-error)]" : "text-[var(--c-text-muted)]"}`}>{state.text}</p>}
      </div>
    </section>
  );
}

function Advanced() {
  const [open, setOpen] = useState(false);
  return (
    <section className="m3-section rounded-lg bg-[var(--c-surface)]">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="m3-section-toggle flex w-full items-center justify-between rounded-lg p-6 text-left hover:bg-[var(--c-hover)]">
        <span>
          <span className="block text-lg font-semibold">Advanced</span>
          <span className="block text-sm text-[var(--c-text-muted)]">Playback fallback (yt-dlp)</span>
        </span>
        <ChevronDown size={20} className={open ? "rotate-180" : ""} aria-hidden />
      </button>
      {open && <div className="px-6 pb-6"><YtdlpSettings /></div>}
    </section>
  );
}

function CreditLink({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-1 text-[var(--c-text)] underline-offset-2 hover:underline" onClick={() => void invoke("open_credit", { name })}>
      {children}
      <ExternalLink size={12} aria-hidden />
    </button>
  );
}

function About() {
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState(false);
  const closeChangelog = useCallback(() => setChangelog(false), []);
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);
  return (
    <section id="settings-about" className="m3-section mt-6 scroll-mt-4 rounded-lg bg-[var(--c-surface)] p-6">
      <h2 className="mb-1 text-lg font-semibold">About</h2>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-[var(--c-text-muted)]">
          <CreditLink name="ytdesk">ytdesk</CreditLink> {version}, MIT license.
          <br />
          Font (Material 3 style): <CreditLink name="google-sans-flex">Google Sans Flex</CreditLink> by Google,{" "}
          <CreditLink name="ofl">SIL Open Font License 1.1</CreditLink>.
        </p>
        <button className="chip inline-flex items-center gap-2" onClick={() => setChangelog(true)}>
          <ScrollText size={16} aria-hidden /> Changelog
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-[var(--c-text-muted)]">Walk through the welcome setup again.</p>
        <button className="chip inline-flex items-center gap-2" onClick={rerunOnboarding}>
          <Hand size={16} aria-hidden /> Run setup again
        </button>
      </div>
      <details className="mt-3 text-sm text-[var(--c-text-muted)]">
        <summary className="cursor-pointer select-none">Google Sans Flex license</summary>
        <pre className="mt-2 max-h-64 select-text overflow-auto whitespace-pre-wrap font-[ui-monospace,monospace] text-xs">{fontLicense}</pre>
      </details>
      {changelog && <ChangelogDialog current={version} onClose={closeChangelog} />}
    </section>
  );
}

export default function SettingsView() {
  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>
      <AppearanceSettings />
      <section className="m3-section mb-6 rounded-lg bg-[var(--c-surface)] p-6">
        <h2 className="mb-1 text-lg font-semibold">Playback</h2>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-[var(--c-text-muted)]">Autoplay similar music when a song, playlist or album ends.</p>
          <AutoplayToggle withLabel={false} />
        </div>
        <HistorySetting />
      </section>
      <section className="m3-section mb-6 rounded-lg bg-[var(--c-surface)] p-6">
        <h2 className="mb-1 text-lg font-semibold">Performance</h2>
        <FlagSetting
          id="render-gpu"
          get="render_get_gpu"
          set="render_set_gpu"
          title="Use GPU for rendering"
          detail="Turn off to keep ytdesk off the graphics card. Uses more CPU instead; on most machines leave it on."
        />
        <div className="mt-4">
          <FlagSetting
            id="close-to-tray"
            get="render_get_close_to_tray"
            set="render_set_close_to_tray"
            title="Close to tray"
            detail="The close button hides ytdesk to the system tray and music keeps playing. Quit from the tray menu."
          />
        </div>
      </section>
      <DiscordSettings />
      <UpdateSettings />
      <Advanced />
      <About />
    </div>
  );
}
