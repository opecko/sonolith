import { AppWindow, ArrowLeft, ChevronRight, Copy, ExternalLink } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { confirmAction } from "../components/ConfirmDialog";
import Switch from "../components/Switch";
import { useToast } from "../stores/toast";
import { SettingCard, SettingRow } from "../views/settings/kit";
import { activityLines, ago, connectionText, scopeRows } from "./apps";
import { Identity } from "./ConsentDialog";
import { useLocalApi, type ConnectedApp } from "./store";

const outlined = "m3-btn m3-outlined flex h-9 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)]";
const danger = "m3-btn m3-text flex h-9 items-center gap-2 rounded-full px-4 text-sm text-[var(--c-error)] hover:bg-[var(--c-hover)]";

function AppIcon({ icon, size = 40 }: { icon: string | null; size?: number }) {
  return icon
    ? <img src={icon} alt="" style={{ width: size, height: size }} className="m3-art shrink-0 rounded-md" />
    : <AppWindow size={size} className="shrink-0 text-[var(--c-text-muted)]" aria-hidden />;
}

function Endpoint({ path }: { path: string }) {
  const copy = () => navigator.clipboard?.writeText(path).then(
    () => useToast.getState().show("Copied to clipboard", "info"),
    () => useToast.getState().show("Could not copy"),
  );
  return (
    <SettingRow id="apiPath" title={path.startsWith("\\\\") ? "Pipe" : "Socket"} detail="Where apps connect. They also find it in discovery.json next to it." stacked>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-text break-all rounded-md bg-fg/5 px-3 py-2 text-xs">{path}</code>
        <button className="icon-btn h-9 w-9 shrink-0" aria-label="Copy path" onClick={() => void copy()}><Copy size={16} /></button>
      </div>
    </SettingRow>
  );
}

function AppRow({ app, onOpen }: { app: ConnectedApp; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-setting={`app:${app.appId}`}
      className="settings-row m3-row flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-[var(--c-hover)]">
      <AppIcon icon={app.icon} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{app.name}</span>
          {app.connections > 0 && <span className="size-2 shrink-0 rounded-full bg-[var(--c-accent)]" role="img" aria-label="Connected now" />}
        </span>
        <span className="block truncate text-xs text-[var(--c-text-muted)]">
          {app.publisher} · {connectionText(app.connections)} · last used {ago(app.lastUsedAt)}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-[var(--c-text-muted)]" aria-hidden />
    </button>
  );
}

function Detail({ app, onBack }: { app: ConnectedApp; onBack: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const remove = async () => {
    const ok = await confirmAction({
      title: `Remove ${app.name}?`,
      message: `${app.name} loses access and its open connections end. It has to ask again, and you'll be asked again.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await invoke("api_remove_app", { appId: app.appId });
    onBack();
  };
  const block = async () => {
    const ok = await confirmAction({
      title: `Block ${app.name}?`,
      message: `${app.name} loses access and can't ask again until you unblock it.`,
      confirmLabel: "Block",
      danger: true,
    });
    if (!ok) return;
    await invoke("api_block", { appId: app.appId });
    onBack();
  };
  const revoke = async (scope: string, label: string) => {
    const ok = await confirmAction({
      title: `Stop "${label.toLowerCase()}"?`,
      message: `${app.name} can no longer do this. It can ask for it again.`,
      confirmLabel: "Revoke",
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
        <SettingRow title="Program" stacked><Identity identity={app.identity} /></SettingRow>
        <SettingRow title="Connected" detail={`${connectionText(app.connections)} · last used ${ago(app.lastUsedAt, now)}`} />
        <SettingRow title="Registered" detail={ago(app.registeredAt, now)} />
      </SettingCard>
      <SettingCard title="What it can do">
        {scopes.length === 0 && <SettingRow title="Nothing" detail="Every permission was revoked." />}
        {scopes.map((s) => (
          <SettingRow key={s.scope} title={s.label} detail={s.allows}>
            <button className={outlined} onClick={() => void revoke(s.scope, s.label)}>Revoke</button>
          </SettingRow>
        ))}
      </SettingCard>
      <SettingCard title="Recent activity">
        {lines.length === 0 && <SettingRow title="Nothing yet" detail="Calls this app makes show up here while Sonolith runs." />}
        {lines.length > 0 && (
          <div className="px-5 py-3">
            <ul className="flex flex-col gap-1 text-sm">
              {lines.slice(0, 20).map((l, i) => (
                <li key={`${l.method}${l.at}${i}`} className="flex items-baseline justify-between gap-4">
                  <code className="select-text text-xs">{l.method}{l.count > 1 && <span className="text-[var(--c-text-muted)]"> ×{l.count}</span>}</code>
                  <span className="shrink-0 text-xs text-[var(--c-text-muted)]">{ago(l.at, now)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingCard>
      <SettingCard>
        <SettingRow title="Remove" detail="Ends its connections and deletes its access. It can ask again.">
          <button className={danger} onClick={() => void remove()}>Remove</button>
        </SettingRow>
        <SettingRow title="Block" detail="Removes it and refuses new requests from it, without asking you.">
          <button className={danger} onClick={() => void block()}>Block</button>
        </SettingRow>
      </SettingCard>
    </>
  );
}

/** Settings → Connected apps: the local API switch, where it listens, who may use it (api/SPEC.md). */
export default function ConnectedAppsSettings() {
  const status = useLocalApi((s) => s.status);
  const apps = useLocalApi((s) => s.apps);
  const blocked = useLocalApi((s) => s.blocked);
  const setEnabled = useLocalApi((s) => s.setEnabled);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const api = useLocalApi.getState();
    void api.refresh().catch(() => {});
    void api.loadApps().catch(() => {});
  }, []);
  const enabled = !!status?.enabled;
  const detail = open ? apps.find((a) => a.appId === open) : undefined;
  if (detail) return <Detail app={detail} onBack={() => setOpen(null)} />;

  const removeAll = async () => {
    const ok = await confirmAction({
      title: "Remove all connected apps?",
      message: `${apps.length === 1 ? "The app loses" : `All ${apps.length} apps lose`} access and open connections end. Blocked apps stay blocked.`,
      confirmLabel: "Remove all",
      danger: true,
    });
    if (ok) await invoke("api_remove_all");
  };
  return (
    <>
      <SettingCard>
        <SettingRow
          id="apiEnabled"
          title="Allow other apps to connect"
          detail={
            <>
              Apps on this computer can ask to see and control what's playing, your queue and your library. Each one needs your approval, and you choose what it may do.
              {enabled && status?.error && <span className="mt-1 block select-text text-[var(--c-error)]">Could not start: {status.error}</span>}
            </>
          }
        >
          <Switch on={enabled} onChange={(v) => void setEnabled(v)} label="Allow other apps to connect" disabled={!status} />
        </SettingRow>
        {status?.running && status.path && <Endpoint path={status.path} />}
        <SettingRow title="For developers" detail="How to build an app that connects to Sonolith: protocol, scopes, examples.">
          <button className={outlined} onClick={() => void invoke("open_credit", { name: "api-spec" })}>
            API reference <ExternalLink size={14} aria-hidden />
          </button>
        </SettingRow>
      </SettingCard>
      <SettingCard title="Apps">
        {apps.length === 0 && (
          <SettingRow title="No apps yet" detail={enabled ? "When an app asks to connect, you'll be asked here and in a notification." : "Turn the switch on, then let an app ask to connect."} />
        )}
        {apps.map((a) => <AppRow key={a.appId} app={a} onOpen={() => setOpen(a.appId)} />)}
        {apps.length > 0 && (
          <SettingRow title="Remove all apps" detail="Ends every connection and deletes all access.">
            <button className={danger} onClick={() => void removeAll()}>Remove all</button>
          </SettingRow>
        )}
      </SettingCard>
      {blocked.length > 0 && (
        <SettingCard title="Blocked apps">
          {blocked.map((b) => (
            <SettingRow key={b.appId + b.identityKey} title={b.name} detail={`Blocked ${ago(b.blockedAt)} · ${b.appId}`}>
              <button className={outlined} onClick={() => void invoke("api_unblock", { appId: b.appId })}>Unblock</button>
            </SettingRow>
          ))}
        </SettingCard>
      )}
    </>
  );
}
