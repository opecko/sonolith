import { invoke } from "@tauri-apps/api/core";
import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fold } from "../../theme/search";
import { SearchField } from "./PaletteGallery";

interface FontFamily {
  name: string;
  mono: boolean;
}

/** Installed fonts, read once per session (scanning the font files takes a moment). */
let cache: Promise<FontFamily[]> | null = null;
const loadFonts = () => (cache ??= invoke<FontFamily[]>("fonts_list").catch((e) => {
  cache = null;
  throw e;
}));

/** Rows rendered at once: each is drawn in its own font, which WebKit has to load. */
const SHOWN = 80;

/** Searchable list of the installed font families, each previewed in itself. */
export default function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [fonts, setFonts] = useState<FontFamily[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    loadFonts().then(
      (f) => live && setFonts(f),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  const matches = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return (fonts ?? []).filter((f) => words.every((w) => fold(f.name).includes(w)));
  }, [fonts, query]);

  if (error) return <p className="text-sm text-[var(--c-error)]">Couldn't list the installed fonts: {error}</p>;
  if (!fonts) return <p className="text-sm text-[var(--c-text-muted)]">Loading installed fonts…</p>;
  return (
    <div className="flex flex-col gap-2">
      <SearchField value={query} onChange={setQuery} placeholder={`Search ${fonts.length} installed fonts`} />
      <ul className="scroll-y max-h-64 rounded-[var(--radius)] border border-[var(--c-outline)] p-1" role="listbox" aria-label="Installed fonts">
        {matches.slice(0, SHOWN).map((f) => {
          const on = f.name === value;
          return (
            <li key={f.name} role="option" aria-selected={on}>
              <button type="button" onClick={() => onChange(f.name)}
                className={`flex w-full items-center gap-2 rounded-[var(--radius)] px-3 py-1.5 text-left ${on ? "bg-[var(--c-active)]" : "hover:bg-[var(--c-hover)]"}`}>
                <span className="min-w-0 flex-1 truncate" style={{ fontFamily: `"${f.name.replace(/["\\]/g, "\\$&")}", var(--font)` }}>{f.name}</span>
                {f.mono && <span className="shrink-0 text-xs text-[var(--c-text-subtle)]">mono</span>}
                {on && <Check size={16} className="shrink-0 text-[var(--c-accent)]" aria-label="Selected" />}
              </button>
            </li>
          );
        })}
        {!matches.length && <li className="px-3 py-4 text-center text-sm text-[var(--c-text-muted)]">Nothing found</li>}
      </ul>
      {matches.length > SHOWN && (
        <p className="text-xs text-[var(--c-text-subtle)]">{matches.length - SHOWN} more; type to narrow the list down.</p>
      )}
    </div>
  );
}
