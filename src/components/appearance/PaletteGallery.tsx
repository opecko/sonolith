import { Moon, Search, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PALETTES } from "../../theme/palettes";
import { searchPalettes } from "../../theme/search";
import type { Mode, Palette } from "../../theme/types";
import PaletteCard from "./PaletteCard";

export function PaletteGrid({ palettes, mode, selected, onSelect }: { palettes: Palette[]; mode: Mode; selected: string; onSelect: (id: string) => void }) {
  if (!palettes.length) return <p className="py-8 text-center text-sm text-[var(--c-text-muted)]">Nothing found</p>;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
      {palettes.map((p) => <PaletteCard key={p.id} palette={p} mode={mode} selected={p.id === selected} onSelect={onSelect} />)}
    </div>
  );
}

export function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opt = (m: Mode, Icon: typeof Sun, label: string) => (
    <button type="button" aria-pressed={mode === m} onClick={() => onChange(m)}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${mode === m ? "bg-fg/15 font-medium" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`}>
      <Icon size={14} aria-hidden /> {label}
    </button>
  );
  return (
    <div className="flex shrink-0 rounded-full bg-fg/5 p-0.5" role="group" aria-label="Color mode">
      {opt("dark", Moon, "Dark")}
      {opt("light", Sun, "Light")}
    </div>
  );
}

export function SearchField({ value, onChange, autoFocus, onEscape, placeholder = "Search palettes" }: {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  onEscape?: () => void;
  placeholder?: string;
}) {
  return (
    <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--c-outline)] bg-[var(--c-bg)] px-3 focus-within:border-[var(--c-text-subtle)]">
      <Search size={16} className="shrink-0 text-[var(--c-text-subtle)]" aria-hidden />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (value) onChange("");
          else onEscape?.();
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--c-text-subtle)]"
      />
    </label>
  );
}

/** Every bundled palette in one overlay, searchable. Esc closes. */
export default function PaletteGallery({ mode, selected, onSelect, onMode, onClose }: {
  mode: Mode;
  selected: string;
  onSelect: (id: string) => void;
  onMode: (m: Mode) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchPalettes(PALETTES, query), [query]);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label="All palettes"
        className="m3-dialog flex h-[min(760px,100%)] w-[min(960px,100%)] flex-col rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] shadow-2xl">
        <header className="flex flex-wrap items-center gap-3 px-6 pb-3 pt-5">
          <h2 className="mr-auto text-lg font-semibold">All palettes</h2>
          <button className="icon-btn h-9 w-9 shrink-0" onClick={onClose} aria-label="Close"><X size={20} /></button>
          <div className="flex w-full flex-wrap items-center gap-3">
            <SearchField value={query} onChange={setQuery} autoFocus onEscape={onClose} />
            <ModeToggle mode={mode} onChange={onMode} />
            <span className="shrink-0 text-sm tabular-nums text-[var(--c-text-muted)]" aria-live="polite">
              {results.length} {results.length === 1 ? "palette" : "palettes"}
            </span>
          </div>
        </header>
        <div className="scroll-y min-h-0 flex-1 px-6 pb-6 pt-1">
          <PaletteGrid palettes={results} mode={mode} selected={selected} onSelect={onSelect} />
        </div>
      </div>
    </div>
  );
}
