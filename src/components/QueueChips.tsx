import { usePlayer } from "../stores/player";

/** Mix chips of a radio queue (All, Familiar, Discover, …); shown in every Now Playing layout. */
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
