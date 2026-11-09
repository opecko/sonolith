import { Copy, Eye, EyeOff, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { confirmAction } from "../components/ConfirmDialog";
import Switch from "../components/Switch";
import { useLocalApi } from "../localApi/store";
import { useToast } from "../stores/toast";
import { SettingCard, SettingRow } from "../views/settings/kit";
import { useRemote } from "./store";

const outlined = "m3-btn m3-outlined flex h-9 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)]";

function phones(paired: number, connected: number): string {
  if (paired === 0) return "No phone is paired yet.";
  const p = paired === 1 ? "1 phone is paired" : `${paired} phones are paired`;
  return connected > 0 ? `${p}, ${connected} connected now.` : `${p}.`;
}

/** The link's port, for the firewall hint. */
function portOf(url: string | null): string | null {
  try {
    return url ? new URL(url).port || null : null;
  } catch {
    return null;
  }
}

/** Settings → Phone remote: the switch with what it means, then the link and its QR code. */
export default function PhoneRemoteSettings() {
  const status = useRemote((s) => s.status);
  const apps = useLocalApi((s) => s.apps);
  const [shown, setShown] = useState(false);
  // Pairing and connecting phones change the counts; Connected apps hears about it first.
  useEffect(() => void useRemote.getState().refresh().catch(() => {}), [apps]);
  useEffect(() => void useLocalApi.getState().loadApps().catch(() => {}), []);
  const enabled = !!status?.enabled;

  const copy = () => status?.url && navigator.clipboard?.writeText(status.url).then(
    () => useToast.getState().show("Copied to clipboard", "info"),
    () => useToast.getState().show("Could not copy"),
  );
  const newLink = async () => {
    const ok = await confirmAction({
      title: "Make a new link?",
      message: "The current link and QR code stop working, and every paired phone is unpaired. Pair each phone again with the new link.",
      confirmLabel: "Make a new link",
      danger: true,
    });
    if (ok) await useRemote.getState().newLink();
  };

  return (
    <>
      <SettingCard>
        <SettingRow
          id="remoteEnabled"
          title="Control Sonolith from your phone"
          detail={
            <>
              {enabled ? "On: starts with Sonolith until you turn it off." : "Off: no phone can connect."}
              {enabled && status?.error && <span className="mt-1 block select-text text-[var(--c-error)]">Could not start: {status.error}</span>}
            </>
          }
        >
          <Switch on={enabled} onChange={(v) => void useRemote.getState().setEnabled(v)} label="Control Sonolith from your phone" disabled={!status} />
        </SettingRow>
        <div className="flex items-start gap-4 px-5 pb-4 pt-1">
          <TriangleAlert size={20} className="mt-0.5 shrink-0 text-[var(--c-text-muted)]" aria-hidden />
          <div className="min-w-0 space-y-1 text-sm text-[var(--c-text-muted)]">
            <p>Use it only on networks you trust, like your home Wi-Fi. It runs over plain HTTP on your local network: anyone on the same network who can see the traffic, or who gets the link or QR code, can control playback.</p>
            <p>The link is a password. Making a new link revokes the old one and unpairs every phone.</p>
            <p>A phone can't see your library or account unless you allow it here in Sonolith.</p>
          </div>
        </div>
      </SettingCard>

      {status?.running && (
        <SettingCard title="Pair a phone">
          {status.noNetwork ? (
            <SettingRow title="No network" detail="This computer isn't connected to a network, so there is no link to show." />
          ) : (
            <>
              <SettingRow
                title="Scan the QR code with your phone"
                detail={`Or open the link in the phone's browser. The phone has to be on the same network.${portOf(status.url) ? ` If it can't connect, a firewall on this computer may be blocking port ${portOf(status.url)} (TCP).` : ""}`}
              >
                <button className={outlined} onClick={() => setShown((v) => !v)} aria-pressed={shown}>
                  {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  {shown ? "Hide" : "Show"}
                </button>
              </SettingRow>
              {shown && status.url && (
                <div className="flex flex-col items-center gap-3 px-5 pb-4">
                  {status.qrSvg && (
                    // Rust draws it from the link alone (src-tauri/src/remote/qr.rs): fixed markup, no outside text.
                    <div className="qr-code w-56 max-w-full rounded-2xl p-2" dangerouslySetInnerHTML={{ __html: status.qrSvg }} />
                  )}
                  <div className="flex w-full items-center gap-2">
                    <code className="min-w-0 flex-1 select-text break-all rounded-md bg-fg/5 px-3 py-2 text-xs">{status.url}</code>
                    <button className="icon-btn h-9 w-9 shrink-0" aria-label="Copy link" onClick={() => void copy()}><Copy size={16} /></button>
                  </div>
                </div>
              )}
            </>
          )}
          <SettingRow title="Paired phones" detail={`${phones(status.paired, status.connected)} They're listed in Connected apps, where you can remove one or take away access.`} />
          <SettingRow title="Make a new link" detail="Unpairs every phone and stops the old link and QR code from working.">
            <button className={outlined} onClick={() => void newLink()}><RefreshCw size={16} aria-hidden /> New link</button>
          </SettingRow>
        </SettingCard>
      )}
    </>
  );
}
