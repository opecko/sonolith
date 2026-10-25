import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

/**
 * A section that starts collapsed ("For developers", "Technical details"). It opens and closes at once, without an
 * animation, so it reads the same with animations on or off.
 */
export default function Disclosure({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm font-medium text-[var(--c-text-muted)] hover:text-[var(--c-text)]">
        <Icon size={16} className="shrink-0" aria-hidden />
        {title}
      </button>
      <div id={id} hidden={!open} className="mt-2">{open && children}</div>
    </div>
  );
}
