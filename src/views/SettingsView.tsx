import {
  ArrowLeft, ChevronDown, ChevronRight, Cpu, Disc3, Download, ExternalLink, Hand, Info, Keyboard, MessageCircle, MicVocal, Paintbrush, Palette, Play,
  Plug, RefreshCw, ScrollText, type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ytdlpInstall, ytdlpSetPath, ytdlpStatus, ytdlpUpdate } from "../api/ytdlp";
import { invoke } from "@tauri-apps/api/core";
import { ColorSettings, LookSettings, NowPlayingSettings } from "../components/appearance/AppearanceSettings";
import AutoplayToggle from "../components/AutoplayToggle";
import ChangelogDialog from "../components/ChangelogDialog";
import Slider from "../components/Slider";
import Switch from "../components/Switch";
import { CROSSFADE_MAX_S } from "../playback/crossfade";
import { ErrorBox, Loading } from "../components/Status";
import { useAsync } from "../hooks/useData";
import { rerunOnboarding } from "../onboarding/store";
import ShortcutSettings from "../shortcuts/ShortcutSettings";
import LyricsProviderSettings from "../lyrics/LyricsProviderSettings";
import ConnectedAppsSettings from "../localApi/ConnectedAppsSettings";
import { useSettingsNav, type SettingsSection } from "../stores/nav";
import { useSettings } from "../stores/settings";
import { useUpdate } from "../stores/update";
import { Segmented, SettingCard, SettingRow } from "./settings/kit";
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

/** A switch kept by the Rust side (config.json), read and written through commands. */
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
    <SettingRow id={id} title={title} detail={detail}>
      <Switch on={flag.data ?? true} onChange={(v) => void change(v)} label={title} disabled={busy || flag.data === undefined} />
    </SettingRow>
  );
}

/** yt-dlp fallback settings; mounted only when its row is opened, so its status isn't probed otherwise. */
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

function PlaybackSettings() {
  const { saveHistory, afterEpisode, crossfade, set } = useSettings();
  return (
    <>
      <SettingCard title="Music">
        <SettingRow id="autoplay" title="Autoplay" detail="When a song, playlist or album ends, keep playing similar music.">
          <AutoplayToggle withLabel={false} />
        </SettingRow>
        <SettingRow id="saveHistory" title="Save listening history" detail="Played songs go to your YouTube Music history, which also improves recommendations. Needs you to be signed in.">
          <Switch on={saveHistory} onChange={(v) => set({ saveHistory: v })} label="Save listening history" />
        </SettingRow>
        <SettingRow id="crossfade" title="Crossfade"
          detail={crossfade ? "Songs blend into each other. The next song loads in the background near the end of the current one." : "Off: one song ends, the next starts."}>
          <Slider className="w-40" value={crossfade} max={CROSSFADE_MAX_S} step={1} onCommit={(v) => set({ crossfade: Math.round(v) })} label="Crossfade"
            tooltip="value" format={(v) => (Math.round(v) ? `${Math.round(v)} s` : "Off")} />
        </SettingRow>
      </SettingCard>
      <SettingCard title="Podcasts">
        <SettingRow id="afterEpisode" title="After an episode" detail="When nothing else is queued: play the show's next episode, or stop.">
          <Segmented value={afterEpisode} options={[["next", "Next episode"], ["stop", "Stop"]]} onChange={(v) => set({ afterEpisode: v })} label="After an episode" />
        </SettingRow>
      </SettingCard>
    </>
  );
}

function DiscordSettings() {
  const { discordRpc, discordButton, discordPodcasts, set } = useSettings();
  return (
    <SettingCard title="Discord status">
      <SettingRow id="discordRpc" title="Show what you're playing" detail="Song, artist, album, cover and progress on your Discord profile (Rich Presence).">
        <Switch on={discordRpc} onChange={(v) => set({ discordRpc: v })} label="Discord Rich Presence" />
      </SettingRow>
      <SettingRow id="discordButton" title={'"Listen on YouTube Music" button'} detail="Lets others open the song you're playing." disabled={!discordRpc}>
        <Switch on={discordButton} onChange={(v) => set({ discordButton: v })} label="Listen on YouTube Music button" />
      </SettingRow>
      <SettingRow id="discordPodcasts" title="Show podcasts too" detail="Also show podcast episodes you're listening to." disabled={!discordRpc}>
        <Switch on={discordPodcasts} onChange={(v) => set({ discordPodcasts: v })} label="Show podcasts on Discord" />
      </SettingRow>
    </SettingCard>
  );
}

function UpdatesCard() {
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
    <SettingCard title="Updates">
      <SettingRow id="updateCheck" title="Check for updates on startup" detail="Looks for a new Sonolith release on GitHub when the app starts.">
        <Switch on={updateCheck} onChange={(v) => set({ updateCheck: v })} label="Check for updates on startup" />
      </SettingRow>
      <SettingRow id="checkNow" title="Check now" detail={state.text ? <span className={state.error ? "text-[var(--c-error)]" : ""}>{state.text}</span> : "Look for a new version right away."}>
        <button onClick={() => void checkNow()} disabled={state.busy}
          className="m3-btn m3-tonal flex h-9 shrink-0 items-center gap-2 rounded-full bg-[var(--c-hover)] px-4 text-sm font-medium hover:bg-[var(--c-active)] disabled:opacity-60">
          <RefreshCw size={16} className={state.busy ? "animate-spin" : ""} aria-hidden /> Check
        </button>
      </SettingRow>
    </SettingCard>
  );
}

function SystemSettings() {
  const [ytdlp, setYtdlp] = useState(false);
  return (
    <>
      <SettingCard title="Window">
        <FlagSetting id="closeToTray" get="render_get_close_to_tray" set="render_set_close_to_tray" title="Close to tray"
          detail="The close button hides Sonolith to the system tray and music keeps playing. Quit from the tray menu." />
        <FlagSetting id="gpu" get="render_get_gpu" set="render_set_gpu" title="Use the graphics card"
          detail="Off keeps Sonolith off the GPU (handy while gaming) and uses more CPU instead. On most machines, leave it on." />
      </SettingCard>
      <UpdatesCard />
      <SettingCard title="Playback engine">
        <SettingRow id="ytdlp" title="yt-dlp" detail="The fallback that finds audio streams. Sonolith keeps its own up-to-date copy unless you set a path.">
          <button className="m3-btn m3-outlined flex h-9 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)]"
            onClick={() => setYtdlp((o) => !o)} aria-expanded={ytdlp}>
            {ytdlp ? "Hide" : "Details"} <ChevronDown size={16} className={ytdlp ? "rotate-180" : ""} aria-hidden />
          </button>
        </SettingRow>
        {ytdlp && <div className="px-5 pb-5"><YtdlpSettings /></div>}
      </SettingCard>
    </>
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
    <>
      <SettingCard title="Sonolith">
        <SettingRow id="version" title={`Version ${version}`} detail={<><CreditLink name="sonolith">Sonolith</CreditLink> is open source, MIT license.</>}>
          <button className="chip inline-flex items-center gap-2" onClick={() => setChangelog(true)}>
            <ScrollText size={16} aria-hidden /> Changelog
          </button>
        </SettingRow>
        <SettingRow id="rerunSetup" title="Run setup again" detail="Walk through the welcome setup again; it starts from your current settings.">
          <button className="chip inline-flex items-center gap-2" onClick={rerunOnboarding}>
            <Hand size={16} aria-hidden /> Run setup
          </button>
        </SettingRow>
      </SettingCard>
      <SettingCard title="Credits">
        <SettingRow id="fontCredit" title="Google Sans Flex" detail={<>The Material 3 style's font, by Google, <CreditLink name="ofl">SIL Open Font License 1.1</CreditLink>.</>} stacked>
          <details className="text-sm text-[var(--c-text-muted)]">
            <summary className="cursor-pointer select-none">Show the license</summary>
            <pre className="mt-2 max-h-64 select-text overflow-auto whitespace-pre-wrap font-[ui-monospace,monospace] text-xs">{fontLicense}</pre>
          </details>
        </SettingRow>
      </SettingCard>
      {changelog && <ChangelogDialog current={version} onClose={closeChangelog} />}
    </>
  );
}

interface Category { id: SettingsSection; title: string; detail: string; icon: LucideIcon; page: () => React.ReactNode }

/** The list, in groups; each group's icons share a color. */
const GROUPS: { tone: string; items: Category[] }[] = [
  { tone: "blue", items: [
    { id: "look", title: "Look", detail: "Style, animations, size, font", icon: Paintbrush, page: () => <LookSettings /> },
    { id: "colors", title: "Colors", detail: "Palette, album art colors", icon: Palette, page: () => <ColorSettings /> },
    { id: "nowplaying", title: "Now Playing", detail: "Layout, ambient light, Save button, visualizer", icon: Disc3, page: () => <NowPlayingSettings /> },
  ] },
  { tone: "green", items: [
    { id: "playback", title: "Playback", detail: "Autoplay, crossfade, history, podcasts", icon: Play, page: () => <PlaybackSettings /> },
    { id: "lyrics", title: "Lyrics", detail: "Karaoke style, providers", icon: MicVocal, page: () => <LyricsProviderSettings /> },
  ] },
  { tone: "orange", items: [
    { id: "shortcuts", title: "Keyboard shortcuts", detail: "Keys inside Sonolith", icon: Keyboard, page: () => <ShortcutSettings /> },
    { id: "discord", title: "Discord", detail: "Show what you're playing", icon: MessageCircle, page: () => <DiscordSettings /> },
    { id: "apps", title: "Connected apps", detail: "Let other apps use Sonolith", icon: Plug, page: () => <ConnectedAppsSettings /> },
  ] },
  { tone: "pink", items: [
    { id: "system", title: "System", detail: "Tray, graphics, updates, yt-dlp", icon: Cpu, page: () => <SystemSettings /> },
  ] },
  { tone: "teal", items: [
    { id: "about", title: "About", detail: "Version, changelog, setup", icon: Info, page: () => <About /> },
  ] },
];
const CATEGORIES = GROUPS.flatMap((g) => g.items.map((c) => ({ ...c, tone: g.tone })));

function pick(id: SettingsSection) {
  useSettingsNav.setState({ section: id, focus: null });
  document.querySelector("main")?.scrollTo(0, 0);
}

/** `current`: the picked category; `fallback`: the one a wide window shows when none is picked (lit only there). */
function CategoryList({ current, fallback }: { current: SettingsSection | null; fallback: SettingsSection }) {
  return (
    <div className="flex flex-col gap-3">
      {GROUPS.map((g) => (
        <ul key={g.tone} className="settings-cats">
          {g.items.map(({ id, title, detail, icon: Icon }) => (
            <li key={id}>
              <button type="button" onClick={() => pick(id)} aria-current={current === id ? "page" : undefined} data-fallback={!current && fallback === id ? "" : undefined}
                className="settings-cat flex w-full items-center gap-4 px-4 py-3 text-left">
                <span className="settings-icon" data-tone={g.tone} aria-hidden><Icon size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">{title}</span>
                  <span className="block truncate text-sm text-[var(--c-text-muted)]">{detail}</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-[var(--c-text-subtle)] @3xl:hidden" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/**
 * Settings: the categories on the left, the picked one on the right. A narrow window shows one at a time: the list,
 * or a category with a way back to it. A link (What's new, onboarding) can open a category and highlight one setting.
 */
export default function SettingsView() {
  const section = useSettingsNav((s) => s.section);
  const focus = useSettingsNav((s) => s.focus);
  const current = CATEGORIES.find((c) => c.id === (section ?? "look"))!;
  useEffect(() => {
    if (!focus) return;
    // Two frames: the category's page has rendered and laid out.
    let a = requestAnimationFrame(() => {
      a = requestAnimationFrame(() => {
        const el = document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(focus)}"]`);
        useSettingsNav.setState({ focus: null });
        if (!el) return;
        el.scrollIntoView({ block: "center" });
        el.setAttribute("data-focused", "");
        window.setTimeout(() => el.removeAttribute("data-focused"), 1800);
      });
    });
    return () => cancelAnimationFrame(a);
  }, [focus, section]);

  return (
    <div className="@container select-text">
      <div className="flex items-start gap-8">
        <nav aria-label="Settings categories" className={`w-full @3xl:sticky @3xl:top-0 @3xl:w-80 @3xl:shrink-0 ${section ? "@max-3xl:hidden" : ""}`}>
          <h1 className="mb-6 text-2xl font-bold">Settings</h1>
          <CategoryList current={section} fallback={current.id} />
        </nav>
        <div className={`min-w-0 max-w-2xl flex-1 ${section ? "" : "@max-3xl:hidden"}`}>
          <div className="mb-6 flex items-center gap-2">
            <button className="icon-btn -ml-2 h-10 w-10 @3xl:hidden" onClick={() => useSettingsNav.setState({ section: null })} aria-label="All settings">
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-2xl font-bold">{current.title}</h2>
          </div>
          {current.page()}
        </div>
      </div>
    </div>
  );
}
