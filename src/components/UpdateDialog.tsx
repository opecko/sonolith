import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUpdate } from "../stores/update";
import ReleaseNotes from "./ReleaseNotes";

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** "New version available" modal: changelog plus Download installer (Windows) or Open GitHub (Linux). */
export default function UpdateDialog() {
  const { available: info, dialogOpen, install, setDialogOpen, installNow } = useUpdate();
  const close = () => setDialogOpen(false);
  const busy = install.status === "downloading" || install.status === "starting";
  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dialogOpen, busy]);
  if (!dialogOpen || !info) return null;

  const progress = install.status === "downloading" && install.total ? Math.min(1, install.downloaded / install.total) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] p-6" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div role="dialog" aria-modal="true" aria-label="Update available"
        className="flex max-h-[80vh] w-[min(520px,100%)] flex-col rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
          <div>
            <h2 className="text-lg font-semibold">ytdesk {info.latest} is available</h2>
            <p className="text-sm text-[var(--c-text-muted)]">You have version {info.current}.</p>
          </div>
          <button className="icon-btn h-10 w-10 shrink-0" onClick={close} disabled={busy} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="scroll-y min-h-0 select-text px-6 py-2 text-sm text-[var(--c-text-muted)]">
          <ReleaseNotes markdown={info.notes} />
        </div>
        <footer className="border-t border-[var(--c-outline)] px-6 py-4">
          {install.status === "error" && <p className="mb-3 select-text text-sm text-[var(--c-error)]">{install.message}</p>}
          {install.status === "downloading" && (
            <div className="mb-3" aria-live="polite">
              <div className="h-1 overflow-hidden rounded-full bg-[var(--c-hover)]">
                <div className="h-full bg-[var(--c-accent)]" style={{ width: `${(progress ?? 0) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-[var(--c-text-muted)]">
                Downloading… {mb(install.downloaded)}{install.total ? ` of ${mb(install.total)}` : ""}
              </p>
            </div>
          )}
          {install.status === "starting" && <p className="mb-3 text-sm text-[var(--c-text-muted)]">Starting the installer. ytdesk will close now.</p>}
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-[var(--c-text-subtle)]">You can turn off update checks in Settings.</p>
            {info.installer ? (
              <button onClick={() => void installNow()} disabled={busy}
                className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-button px-5 text-sm font-medium text-on-button hover:scale-105 disabled:opacity-60 disabled:hover:scale-100">
                {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Download size={18} aria-hidden />}
                {install.status === "error" ? "Try again" : "Download installer"}
              </button>
            ) : (
              <button onClick={() => void invoke("update_open_page").catch(() => {})}
                className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-button px-5 text-sm font-medium text-on-button hover:scale-105">
                <ExternalLink size={18} aria-hidden /> Open GitHub
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

/** Top bar chip, shown only when a newer release exists. */
export function UpdateChip() {
  const available = useUpdate((s) => s.available);
  if (!available) return null;
  return (
    <button onClick={() => useUpdate.getState().setDialogOpen(true)} title={`ytdesk ${available.latest} is available`}
      className="flex h-8 shrink-0 items-center gap-2 rounded-full bg-[var(--c-accent)] px-3 text-sm font-medium text-on-accent hover:brightness-110">
      <Download size={16} aria-hidden /> New version available!
    </button>
  );
}
