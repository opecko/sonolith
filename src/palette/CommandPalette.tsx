import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { commands, searchCommand, type Command } from "./catalog";
import { rankItems } from "./rank";
import { closePalette, usePalette } from "./store";

/**
 * Command palette (Ctrl+K by default, Settings → Keyboard shortcuts): type to find a place, a playback action or a
 * setting; Enter runs it, a query nothing matches searches YouTube Music. ↑/↓ move, Esc closes. Appears without
 * animation (WebKitGTK flashes the end of opacity/transform animations).
 */
export default function CommandPalette() {
  const open = usePalette((s) => s.open);
  return open ? <Palette /> : null;
}

function Palette() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // The commands as they are when the palette opens (Play vs Pause, Mute vs Unmute…).
  const all = useMemo(commands, []);
  const shown = useMemo(() => {
    const found: Command[] = rankItems(query, all);
    return query.trim() ? [...found, searchCommand(query)] : found;
  }, [query, all]);
  const current = Math.min(active, shown.length - 1);

  // Focus goes back where it was when the palette closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => before?.focus?.({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    list.current?.querySelector(`[data-i="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    closePalette();
    c.run();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = shown.length;
      setActive((current + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(shown[current]);
    } else if (e.key === "Escape") {
      // Not also Now Playing's Esc, which listens on the document.
      e.preventDefault();
      e.nativeEvent.stopImmediatePropagation();
      closePalette();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-center bg-[var(--c-overlay)] px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div role="dialog" aria-modal="true" aria-label="Command palette"
        className="m3-dialog flex max-h-[min(480px,76vh)] w-[min(560px,100%)] flex-col self-start overflow-hidden rounded-[var(--m3-corner-xl)] bg-[var(--m3-surface-container-high)] text-[var(--m3-on-surface)] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-[var(--m3-outline-variant)] px-4">
          <Search size={20} className="shrink-0 text-[var(--m3-on-surface-variant)]" aria-hidden />
          <input ref={input} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
            placeholder="Go to, play, change a setting, or search" aria-label="Command" spellCheck={false}
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={shown[current] ? `palette-${shown[current].id}` : undefined}
            className="type-body-large h-14 min-w-0 flex-1 select-text bg-transparent outline-none placeholder:text-[var(--m3-on-surface-variant)]" />
        </div>
        <ul ref={list} id="palette-list" role="listbox" aria-label="Commands" className="scroll-y min-h-0 flex-1 py-2">
          {shown.map((c, i) => (
            <li key={c.id} id={`palette-${c.id}`} data-i={i} role="option" aria-selected={i === current}
              onMouseMove={() => i !== current && setActive(i)} onClick={() => run(c)}
              className={`mx-2 flex cursor-pointer items-center gap-3 rounded-[var(--m3-corner-md)] px-3 py-2.5 ${i === current ? "bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]" : ""}`}>
              <span className="type-body-large min-w-0 flex-1 truncate">{c.title}</span>
              <span className="type-label-medium shrink-0 text-[var(--m3-on-surface-variant)]">{c.group}</span>
              {i === current && <CornerDownLeft size={16} className="shrink-0" aria-hidden />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
