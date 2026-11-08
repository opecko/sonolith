import { Maximize2 } from "lucide-react";
import { growWindow } from "./windowSize";

/** A window smaller than even the mini player (compact/layout.ts): just asks for more room. */
export default function TooSmall() {
  return (
    <main role="status" className="fixed inset-0 z-[45] flex flex-col items-center justify-center gap-1 overflow-hidden bg-[var(--c-bg)] p-2 text-center text-[var(--c-text)]">
      <button className="icon-btn m3-icon-tonal h-9 w-9 shrink-0" onClick={growWindow} aria-label="Make the window bigger" title="Make the window bigger">
        <Maximize2 size={18} />
      </button>
      <p className="type-label-large">Window too small</p>
      <p className="type-body-small text-[var(--c-text-muted)]">Make it bigger to use Sonolith.</p>
    </main>
  );
}
