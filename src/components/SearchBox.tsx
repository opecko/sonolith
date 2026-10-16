import { History, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Item } from "../api/types";
import { useSuggestions } from "../hooks/useSuggestions";
import { openItem, openSearch, useNav } from "../stores/nav";
import { usePlayer } from "../stores/player";
import Thumb from "./Thumb";

function activate(item: Item) {
  if (item.type === "track") usePlayer.getState().playRadio(item);
  else openItem(item);
}

export default function SearchBox() {
  const routeQuery = useNav((s) => (s.route.name === "search" ? s.route.query : ""));
  const [input, setInput] = useState(routeQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, error } = useSuggestions(input, open);
  type Row = { q?: string; item?: Item };
  const rows: Row[] = [...data.queries.slice(0, 7).map((q) => ({ q })), ...data.items.slice(0, 4).map((item) => ({ item }))];

  useEffect(() => {
    setInput(routeQuery);
  }, [routeQuery]);
  useEffect(() => {
    setActive(-1);
  }, [data]);

  const choose = (row: { q?: string; item?: Item }) => {
    setOpen(false);
    if (row.item) activate(row.item);
    else if (row.q) {
      setInput(row.q);
      openSearch(row.q);
    }
    inputRef.current?.blur();
  };

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        choose(active >= 0 ? rows[active] : { q: input });
      }}
      className="relative w-full min-w-0 max-w-[480px]"
    >
      <Search size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--c-text-muted)]" aria-hidden />
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => { setInput(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
          else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
        }}
        placeholder="Search songs, albums, artists, podcasts"
        aria-label="Search"
        aria-autocomplete="list"
        className="m3-search h-10 w-full select-text rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-2)] pl-12 pr-10 text-sm text-[var(--c-text)] outline-none placeholder:text-[var(--c-text-subtle)] focus:border-[var(--c-text-subtle)] focus:bg-[var(--c-surface-3)]"
      />
      {input && (
        <button type="button" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => { setInput(""); inputRef.current?.focus(); }}
          className="icon-btn absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2">
          <X size={18} />
        </button>
      )}
      {open && input.trim() && (rows.length > 0 || error) && (
        <ul role="listbox" className="m3-menu absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] py-2 shadow-2xl">
          {error && <li className="px-4 py-2 text-xs text-[var(--c-error)]">Suggestions failed: {error}</li>}
          {rows.map((row, i) => (
            <li key={row.q ?? `${row.item!.type}:${row.item!.id}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(row)}
                className={`m3-menu-item flex w-full items-center gap-4 px-4 py-2 text-left text-sm ${i === active ? "bg-[var(--c-hover)]" : "hover:bg-[var(--c-hover)]"}`}
              >
                {row.q ? (
                  <>
                    <History size={18} className="shrink-0 text-[var(--c-text-muted)]" aria-hidden />
                    <span className="truncate">{row.q}</span>
                  </>
                ) : (
                  <>
                    <Thumb src={row.item!.thumbnail} round={row.item!.art === "round"} px={32} className="h-8 w-8 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate">{row.item!.title}</span>
                      <span className="block truncate text-xs text-[var(--c-text-muted)]">{row.item!.subtitle}</span>
                    </span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
