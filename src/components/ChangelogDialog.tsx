import { invoke } from "@tauri-apps/api/core";
import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import ReleaseNotes from "./ReleaseNotes";

interface Entry {
  version: string;
  date: string;
  notes: string;
}

/** Fetched once per session (GitHub's API allows 60 unauthenticated requests an hour). */
let cache: Promise<Entry[]> | null = null;
const loadChangelog = () => (cache ??= invoke<Entry[]>("update_changelog").catch((e) => {
  cache = null;
  throw e;
}));

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
};

/** Every published release with its notes, newest first; the installed version is marked. */
export default function ChangelogDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    loadChangelog().then(
      (e) => live && setEntries(e),
      (e) => live && setError(String(e)),
    );
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      live = false;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Changelog"
        className="m3-dialog flex max-h-[80vh] w-[min(640px,100%)] flex-col rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] shadow-2xl">
        <header className="flex items-center justify-between gap-4 px-6 pb-2 pt-5">
          <h2 className="text-lg font-semibold">Changelog</h2>
          <button className="icon-btn h-10 w-10 shrink-0" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="scroll-y min-h-0 select-text px-6 pb-6 pt-2 text-sm text-[var(--c-text-muted)]">
          {error ? (
            <p className="text-[var(--c-error)]">{error}</p>
          ) : !entries ? (
            <p className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden /> Loading releases…</p>
          ) : !entries.length ? (
            <p>No releases yet.</p>
          ) : (
            entries.map((e) => (
              <section key={e.version} className="border-t border-[var(--c-outline)] pb-2 pt-4 first:border-t-0 first:pt-0">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                  <h3 className="text-base font-semibold text-[var(--c-text)]">ytdesk {e.version}</h3>
                  {e.version === current && <span className="rounded-full bg-[var(--c-accent)] px-2 py-0.5 text-xs font-medium text-on-accent">Installed</span>}
                  <span className="text-xs text-[var(--c-text-subtle)]">{day(e.date)}</span>
                </div>
                <ReleaseNotes markdown={e.notes} />
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
