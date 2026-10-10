import { usePlayer } from "../stores/player";
import AutoplayToggle from "./AutoplayToggle";
import QueueList from "./QueueList";

export function QueueChips() {
  const chips = usePlayer((s) => s.chips);
  const active = usePlayer((s) => s.activeChipId);
  const loading = usePlayer((s) => s.chipLoading);
  const selectChip = usePlayer((s) => s.selectChip);
  if (!chips.length) return null;
  return (
    <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto px-2">
      {chips.map((c) => (
        <button
          key={c.id}
          onClick={() => selectChip(c.id)}
          aria-pressed={c.id === active}
          disabled={loading && c.id === active}
          className="chip"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export default function QueuePanel() {
  return (
    <aside aria-label="Queue" className="flex w-[360px] shrink-0 flex-col border-l border-[var(--c-outline)] bg-[var(--c-surface)] py-4 pl-2 pr-1">
      <div className="mb-4 flex items-center justify-between px-2">
        <h2 className="text-base font-semibold">Up next</h2>
        <AutoplayToggle />
      </div>
      <QueueChips />
      <div className="scroll-y min-h-0 flex-1">
        <QueueList autoScroll />
      </div>
    </aside>
  );
}
