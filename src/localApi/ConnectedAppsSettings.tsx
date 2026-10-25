import { AppWindow, ArrowLeft, ChevronRight, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { confirmAction } from "../components/ConfirmDialog";
import Switch from "../components/Switch";
import { useToast } from "../stores/toast";
import { SettingCard, SettingRow } from "../views/settings/kit";
import { activityLines, ago, allowedSummary, connectionText, holdText, scopeRows, type Hold } from "./apps";
import { Identity } from "./ConsentDialog";
import Disclosure from "./Disclosure";
import { useLocalApi, type ApiStatus, type ConnectedApp } from "./store";

const outlined = "m3-btn m3-outlined flex h-9 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)]";
const danger = "m3-btn m3-text flex h-9 items-center gap-2 rounded-full px-4 text-sm text-[var(--c-error)] hover:bg-[var(--c-hover)]";

/** `Date.now()`, every `ms` (none: frozen), so nothing repaints when nothing on screen changes with time. */
function useNow(ms: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (ms === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Holds still counting down (every second while there are any, else every `idleMs`); reloads when one runs out. */
function useHolds(idleMs: number | null = null): { holds: Hold[]; now: number } {
  const all = useLocalApi((s) => s.onHold);
  const now = useNow(all.length > 0 ? 1000 : idleMs);
  const holds = all.filter((h) => h.until > now);
  const ended = holds.length < all.length;
  useEffect(() => {
    if (ended) void useLocalApi.getState().loadApps().catch(() => {});
  }, [ended]);
  return { holds, now };
}

const allowAgain = (appId: string) => void invoke("api_allow_asking_again", { appId });

function AppIcon({ icon, size = 40 }: { icon: string | null; size?: number }) {
  return icon
    ? <img src={icon} alt="" style={{ width: size, height: size }} className="m3-art shrink-0 rounded-md" />
    : <AppWindow size={size} className="shrink-0 text-[var(--c-text-muted)]" aria-hidden />;
}

function AppRow({ app, hold, now, onOpen }: { app: ConnectedApp; hold?: Hold; now: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-setting={`app:${app.appId}`}
      className="settings-row m3-row flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-[var(--c-hover)]">
      <AppIcon icon={app.icon} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{app.name}</span>
          {app.connections > 0 && <span className="size-2 shrink-0 rounded-full bg-[var(--c-accent)]" aria-hidden />}
        </span>
        <span className="block truncate text-xs text-[var(--c-text-muted)]">{allowedSummary(app.scopes)}</span>
        <span className="block truncate text-xs text-[var(--c-text-muted)]">{hold ? holdText(hold, now) : connectionText(app.connections)}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-[var(--c-text-muted)]" aria-hidden />
    </button>
  );
}

/** An app that asked, was told no, and has to wait before it may ask again. */
function HoldRow({ hold, now }: { hold: Hold; now: number }) {
  return (
    <div className="settings-row flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-4">
        <AppIcon icon={null} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{hold.name}</span>
          <span className="block text-xs text-[var(--c-text-muted)]">{holdText(hold, now)}</span>
        </span>
      </div>
      <button className={outlined} onClick={() => allowAgain(hold.appId)}>Allow it to ask again</button>
    </div>
  );
}

function Detail({ app, onBack }: { app: ConnectedApp; onBack: () => void }) {
  const { holds, now } = useHolds(15_000);
  const hold = holds.find((h) => h.appId === app.appId);
  const remove = async () => {
    const ok = await confirmAction({
      title: `Remove ${app.name}?`,
      message: `${app.name} can no longer see or control Sonolith and is disconnected right away. If it asks to connect again, you'll be asked again.`,
      confirmLabel: "Remove app",
      danger: true,
    });
    if (!ok) return;
    await invoke("api_remove_app", { appId: app.appId });
    onBack();
  };
  const block = async () => {
    const ok = await confirmAction({
      title: `Block ${app.name}?`,
      message: `${app.name} is removed and disconnected, and Sonolith ignores it from now on without asking you. You can unblock it here later.`,
      confirmLabel: "Block app",
      danger: true,
    });
    if (!ok) return;
    await invoke("api_block", { appId: app.appId });
    onBack();
  };
  const revoke = async (scope: string, label: string) => {
    const ok = await confirmAction({
      title: `Remove "${label}"?`,
      message: `${app.name} can no longer do this. It can ask you for it again later.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) await invoke("api_revoke_scope", { appId: app.appId, scope });
  };
  const scopes = scopeRows(app.scopes);
  const lines = activityLines(app.activity);
  return (
    <>
      <button type="button" className="mb-3 flex items-center gap-2 px-1 text-sm text-[var(--c-text-muted)] hover:text-[var(--c-text)]" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden /> Connected apps
      </button>
      <SettingCard>
        <div className="flex items-start gap-4 px-5 py-4">
          <AppIcon icon={app.icon} size={48} />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">{app.name}</h3>
            <p className="text-sm text-[var(--c-text-muted)]">by {app.publisher}</p>
            <p className="mt-1 select-text text-sm">{app.description}</p>
            {app.homepage && <p className="mt-1 select-text break-all text-xs text-[var(--c-text-muted)]">{app.homepage}</p>}
          </div>
        </div>
        <SettingRow title={connectionText(app.connections)} detail={`Last used ${ago(app.lastUsedAt, now)}`} />
        {hold && (
          <SettingRow title={holdText(hold, now)} detail="You said no to its last request. It can ask again when the time is up.">
            <button className={outlined} onClick={() => allowAgain(app.appId)}>Allow it to ask again</button>
          </SettingRow>
        )}
      </SettingCard>
      <SettingCard title="Allowed to">
        {scopes.length === 0 && <SettingRow title="Nothing" detail="You removed every permission. It can ask for them again." />}
        {scopes.map((s) => (
          <SettingRow key={s.scope} title={s.label} detail={s.allows}>
            <button className={outlined} aria-label={`Remove "${s.label}"`} onClick={() => void revoke(s.scope, s.label)}>Remove</button>
          </SettingRow>
        ))}
      </SettingCard>
      <SettingCard>
        <SettingRow title="Remove app" detail="Disconnects it and takes away all its access. It can ask again.">
          <button className={danger} onClick={() => void remove()}>Remove app</button>
        </SettingRow>
        <SettingRow title="Block app" detail="Removes it and ignores it from now on, without asking you.">
          <button className={danger} onClick={() => void block()}>Block app</button>
        </SettingRow>
      </SettingCard>
      <Disclosure title="Technical details" className="mb-4 px-1">
        <div className="flex flex-col gap-3 text-sm">
          <Identity identity={app.identity} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-[var(--c-text-muted)]">App id</dt><dd className="select-text break-all font-[ui-monospace,monospace]">{app.appId}</dd>
            <dt className="text-[var(--c-text-muted)]">Allowed</dt><dd>{ago(app.registeredAt, now)}</dd>
          </dl>
          <div>
            <p className="mb-1 text-xs text-[var(--c-text-muted)]">Recent calls (since Sonolith started)</p>
            {lines.length === 0 ? <p className="text-xs">None yet.</p> : (
              <ul className="flex flex-col gap-1">
                {lines.slice(0, 20).map((l, i) => (
                  <li key={`${l.method}${l.at}${i}`} className="flex items-baseline justify-between gap-4">
                    <code className="select-text text-xs">{l.method}{l.count > 1 && <span className="text-[var(--c-text-muted)]"> ×{l.count}</span>}</code>
                    <span className="shrink-0 text-xs text-[var(--c-text-muted)]">{ago(l.at, now)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Disclosure>
    </>
  );
}

function OnOff({ status }: { status: ApiStatus | null }) {
  const setEnabled = useLocalApi((s) => s.setEnabled);
  const enabled = !!status?.enabled;
  return (
    <SettingRow
      id="apiEnabled"
      title="Let other apps connect to Sonolith"
      detail={
        <>
          {enabled ? "Apps can ask you for access." : "Off: no app can connect, and apps you've allowed are disconnected."}
          {enabled && status?.error && <span className="mt-1 block select-text text-[var(--c-error)]">Could not start: {status.error}</span>}
        </>
      }
    >
      <Switch on={enabled} onChange={(v) => void setEnabled(v)} label="Let other apps connect to Sonolith" disabled={!status} />
    </SettingRow>
  );
}

function ForDevelopers({ status }: { status: ApiStatus | null }) {
  const path = status?.running ? status.path : null;
  const copy = () => path && navigator.clipboard?.writeText(path).then(
    () => useToast.getState().show("Copied to clipboard", "info"),
    () => useToast.getState().show("Could not copy"),
  );
  return (
    <Disclosure title="For developers" className="mb-4 px-1">
      <SettingCard>
        <SettingRow title="Build an app for Sonolith" detail="Apps talk to Sonolith over a local JSON-RPC protocol: registration, scopes, events, examples in Python, Node and shell.">
          <button className={outlined} onClick={() => void invoke("open_credit", { name: "api-spec" })}>
            API documentation <ExternalLink size={14} aria-hidden />
          </button>
        </SettingRow>
        <SettingRow id="apiPath" title={path?.startsWith("\\\\") ? "Pipe" : "Socket"} stacked
          detail={path ? "Where apps connect. They also find it in discovery.json next to it." : "Shown here while the switch above is on."}>
          {path && (
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 select-text break-all rounded-md bg-fg/5 px-3 py-2 text-xs">{path}</code>
              <button className="icon-btn h-9 w-9 shrink-0" aria-label="Copy path" onClick={() => void copy()}><Copy size={16} /></button>
            </div>
          )}
        </SettingRow>
      </SettingCard>
    </Disclosure>
  );
}

/** Settings → Connected apps: who may use Sonolith and what they may do, the switch, then the developer details. */
export default function ConnectedAppsSettings() {
  const status = useLocalApi((s) => s.status);
  const apps = useLocalApi((s) => s.apps);
  const blocked = useLocalApi((s) => s.blocked);
  const registryProblem = useLocalApi((s) => s.registryProblem);
  const { holds, now } = useHolds();
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const api = useLocalApi.getState();
    void api.refresh().catch(() => {});
    void api.loadApps().catch(() => {});
  }, []);
  const detail = open ? apps.find((a) => a.appId === open) : undefined;
  if (detail) return <Detail app={detail} onBack={() => setOpen(null)} />;

  const removeAll = async () => {
    const ok = await confirmAction({
      title: "Remove all apps?",
      message: `${apps.length === 1 ? "The app is" : `All ${apps.length} apps are`} disconnected and lose their access. Each one has to ask you again. Blocked apps stay blocked.`,
      confirmLabel: "Remove all",
      danger: true,
    });
    if (ok) await invoke("api_remove_all");
  };
  // Denied apps that are already connected show the wait in their own row.
  const waiting = holds.filter((h) => !apps.some((a) => a.appId === h.appId));
  const empty = apps.length === 0 && waiting.length === 0;
  return (
    <>
      {registryProblem && (
        <SettingCard>
          <SettingRow title="Connected apps were reset" detail={<span className="select-text text-[var(--c-error)]">{registryProblem}</span>} />
        </SettingCard>
      )}
      {empty ? (
        <SettingCard>
          <div className="flex items-start gap-4 px-5 py-4">
            <ShieldCheck size={32} className="mt-0.5 shrink-0 text-[var(--c-text-muted)]" aria-hidden />
            <div className="min-w-0 text-sm">
              <p>Widgets, bars and scripts can show what's playing or control Sonolith. Nothing is connected right now.</p>
              <p className="mt-1 text-[var(--c-text-muted)]">Nothing can connect without your approval: each app asks first, and you choose what it may do.</p>
            </div>
          </div>
          <OnOff status={status} />
        </SettingCard>
      ) : (
        <>
          <SettingCard title="Apps you've allowed">
            {apps.map((a) => <AppRow key={a.appId} app={a} hold={holds.find((h) => h.appId === a.appId)} now={now} onOpen={() => setOpen(a.appId)} />)}
            {waiting.map((h) => <HoldRow key={h.appId} hold={h} now={now} />)}
            {apps.length > 0 && (
              <SettingRow title="Remove all apps" detail="Disconnects every app and takes away all access.">
                <button className={danger} onClick={() => void removeAll()}>Remove all</button>
              </SettingRow>
            )}
          </SettingCard>
          <SettingCard>
            <OnOff status={status} />
          </SettingCard>
        </>
      )}
      {blocked.length > 0 && (
        <SettingCard title="Blocked apps">
          {blocked.map((b) => (
            <SettingRow key={b.appId + b.identityKey} title={b.name} detail={`Blocked ${ago(b.blockedAt)}${b.appWide ? "" : " · only the program that asked"}`}>
              <button className={outlined} onClick={() => void invoke("api_unblock", { appId: b.appId })}>Unblock</button>
            </SettingRow>
          ))}
        </SettingCard>
      )}
      <ForDevelopers status={status} />
    </>
  );
}
