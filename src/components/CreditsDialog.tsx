import { X } from "lucide-react";
import { Spinner } from "./LoadingIndicator";
import { useEffect } from "react";
import { useUi } from "../stores/ui";

/** "View song credits" modal. */
export default function CreditsDialog() {
  const credits = useUi((s) => s.credits);
  const close = () => useUi.getState().setCredits(null);
  useEffect(() => {
    if (!credits) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [credits]);
  if (!credits) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Song credits"
        className="m3-dialog flex max-h-[80vh] w-[min(480px,100%)] flex-col rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] shadow-2xl">
        <header className="flex items-center justify-between px-6 pb-2 pt-4">
          <h2 className="text-lg font-semibold">{credits.status === "ok" ? credits.data.title : "Song credits"}</h2>
          <button className="icon-btn h-10 w-10" onClick={close} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="scroll-y min-h-0 px-6 pb-6">
          {credits.status === "loading" && <div className="my-8 flex justify-center"><Spinner size={24} className="text-[var(--c-text-muted)]" /></div>}
          {credits.status === "error" && <p className="py-4 text-sm text-[var(--c-error)]">{credits.message}</p>}
          {credits.status === "ok" && (credits.data.sections.length === 0
            ? <p className="py-4 text-sm text-[var(--c-text-muted)]">No credits for this song.</p>
            : credits.data.sections.map((s) => (
              <section key={s.title} className="py-3">
                <h3 className="text-sm font-medium">{s.title}</h3>
                <p className="select-text whitespace-pre-line text-sm text-[var(--c-text-muted)]">{s.text}</p>
              </section>
            )))}
        </div>
      </div>
    </div>
  );
}
