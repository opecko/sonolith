import { Check } from "lucide-react";
import { memo } from "react";
import { hasMode, previewOf } from "../../theme/palettes";
import type { Mode, Palette } from "../../theme/types";

/** A palette as a color strip plus a tiny mock of the app drawn in its colors. Click applies it. */
const PaletteCard = memo(function PaletteCard({ palette, mode, selected, onSelect }: {
  palette: Palette;
  mode: Mode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const available = hasMode(palette, mode);
  const c = previewOf(palette, mode);
  return (
    <button
      type="button"
      disabled={!available}
      onClick={() => onSelect(palette.id)}
      aria-pressed={selected}
      title={available ? palette.name : `${palette.name} has no ${mode} variant`}
      className={`group flex flex-col overflow-hidden rounded-[var(--radius)] border-2 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
        selected ? "border-[var(--c-accent)]" : "border-[var(--c-outline)] enabled:hover:border-[var(--c-text-subtle)]"
      }`}
    >
      <div className="flex h-2">
        {c.strip.map((s, i) => <span key={i} className="flex-1" style={{ background: s }} />)}
      </div>
      <div className="flex h-16 gap-1.5 p-2" style={{ background: c.bg }} aria-hidden>
        <div className="flex flex-1 flex-col justify-center gap-1 rounded px-1.5" style={{ background: c.card }}>
          <span className="h-1.5 w-3/4 rounded-full" style={{ background: c.text }} />
          <span className="h-1.5 w-1/2 rounded-full" style={{ background: c.muted }} />
        </div>
        <span className="flex w-8 items-center justify-center self-center rounded-full py-1 text-[10px] font-bold" style={{ background: c.accent, color: c.onAccent }}>
          Aa
        </span>
      </div>
      <div className="flex items-center gap-1 bg-[var(--c-surface-2)] px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{palette.name}</span>
        {selected && <Check size={14} className="shrink-0 text-[var(--c-accent)]" aria-label="Selected" />}
      </div>
    </button>
  );
});

export default PaletteCard;
