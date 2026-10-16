import { ScrollText, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Spring } from "../motion";
import { runWhatsNewAction, useWhatsNew } from "./store";

/**
 * "Updated to X.Y.Z" dialog: the release's highlights and its in-app actions. Opens with a spring pop (scale and
 * opacity from the frame loop, so it simply appears with animations off); Esc and outside click close.
 */
export default function WhatsNewDialog() {
  const entry = useWhatsNew((s) => s.entry);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => useWhatsNew.getState().show(null);
  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [entry]);
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const s = new Spring(0, "defaultSpatial", (p) => {
      el.style.opacity = String(Math.min(1, Math.max(0, p * 1.4)));
      el.style.transform = `scale(${0.92 + 0.08 * p})`;
    });
    s.set(0);
    s.to(1, () => {
      el.style.opacity = "";
      el.style.transform = "";
    });
    return () => s.stop();
  }, [entry]);
  if (!entry) return null;
  const [first, ...rest] = entry.actions ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="whats-new-title"
        className="m3-dialog flex max-h-[85vh] w-[min(560px,100%)] flex-col rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
          <div>
            <p className="text-sm font-medium text-[var(--m3-primary)]">Updated to {entry.version}</p>
            <h2 id="whats-new-title" className="mt-1 text-lg font-semibold">{entry.title}</h2>
          </div>
          <button className="icon-btn h-10 w-10 shrink-0" onClick={close} aria-label="Close"><X size={20} /></button>
        </header>
        <ul className="scroll-y flex min-h-0 flex-col gap-4 px-6 py-3">
          {entry.highlights.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <span className="m3-whats-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--c-hover)]" aria-hidden><Icon size={20} /></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-sm text-[var(--c-text-muted)]">{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <footer className="flex flex-col gap-2 px-6 pb-6 pt-4">
          {first && (
            <button className="m3-btn m3-filled flex h-10 items-center justify-center gap-2 rounded-full bg-button px-5 text-sm font-medium text-on-button hover:bg-button/90"
              onClick={() => runWhatsNewAction(first.action)} autoFocus>
              {first.label}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {rest.map((a) => (
              <button key={a.label} className="m3-btn m3-tonal flex h-10 items-center rounded-full bg-[var(--c-hover)] px-4 text-sm font-medium hover:bg-[var(--c-active)]"
                onClick={() => runWhatsNewAction(a.action)}>
                {a.label}
              </button>
            ))}
            <button className="m3-btn m3-text ml-auto flex h-10 items-center gap-2 rounded-full px-3 text-sm text-[var(--c-text-muted)] hover:bg-[var(--c-hover)]"
              onClick={() => runWhatsNewAction({ type: "openSettings", section: "about" })}>
              <ScrollText size={16} aria-hidden /> Full changelog
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
