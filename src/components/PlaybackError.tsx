import { AlertCircle, Copy, X } from "lucide-react";
import { useState } from "react";

/** One-line error with a popover holding the full (selectable, copyable) text. */
export default function PlaybackError({ error }: { error: string }) {
  const [open, setOpen] = useState(false);
  const firstLine = error.split("\n")[0];
  return (
    <span className="relative flex min-w-0 items-center gap-1 text-xs text-[var(--c-error)]">
      <AlertCircle size={14} className="shrink-0" aria-hidden />
      <button onClick={() => setOpen((o) => !o)} className="truncate text-left underline-offset-2 hover:underline" title="Show full error" aria-expanded={open}>
        {firstLine}
      </button>
      {open && (
        <div role="dialog" aria-label="Playback error details"
          className="m3-surface-card absolute bottom-7 left-0 z-40 w-[min(560px,80vw)] rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] p-4 text-[var(--c-text)] shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">Playback error</span>
            <span className="flex gap-1">
              <button className="icon-btn h-8 w-8" aria-label="Copy error" onClick={() => void navigator.clipboard?.writeText(error)}><Copy size={16} /></button>
              <button className="icon-btn h-8 w-8" aria-label="Close" onClick={() => setOpen(false)}><X size={16} /></button>
            </span>
          </div>
          <pre className="max-h-64 select-text overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-[var(--c-text-muted)]">{error}</pre>
          <p className="mt-2 text-xs text-[var(--c-text-subtle)]">Also appended to debug/playback.log.</p>
        </div>
      )}
    </span>
  );
}
