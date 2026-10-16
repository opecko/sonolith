import { Wrench } from "lucide-react";
import { useState } from "react";
import { UiStyleScope } from "../components/UiStyle";
import DevPanel from "./DevPanel";

/** "Dev build" assist chip in the top bar (tertiary); opens the dev panel. */
export default function DevChip() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="flex h-8 shrink-0 items-center gap-2 rounded-[var(--m3-corner-sm)] bg-[var(--m3-tertiary-container)] px-3 text-sm font-medium text-[var(--m3-on-tertiary-container)] hover:bg-[color-mix(in_srgb,var(--m3-on-tertiary-container)_8%,var(--m3-tertiary-container))]"
        onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Developer tools (dev builds only)">
        <Wrench size={16} aria-hidden /> Dev build
      </button>
      {open && <UiStyleScope value="m3"><DevPanel onClose={() => setOpen(false)} /></UiStyleScope>}
    </>
  );
}
