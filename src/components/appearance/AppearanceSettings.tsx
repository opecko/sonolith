import { ChevronDown, Download, LayoutGrid, RotateCcw, Upload } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { setAppearance, useSettings } from "../../stores/settings";
import { DEFAULT_APPEARANCE } from "../../theme/appearance";
import { FEATURED } from "../../theme/featured";
import { effectiveTokens } from "../../theme/index";
import { getPalette, hasMode, PALETTES } from "../../theme/palettes";
import { searchPalettes } from "../../theme/search";
import type { Mode } from "../../theme/types";
import ColorEditor, { ContrastWarnings } from "./ColorEditor";
import PaletteGallery, { ModeToggle, PaletteGrid, SearchField } from "./PaletteGallery";
import ThemeTransfer from "./ThemeTransfer";

const FEATURED_PALETTES = FEATURED.map((id) => PALETTES.find((p) => p.id === id)).filter((p) => !!p);

const outlineBtn = "flex h-9 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)]";

export default function AppearanceSettings() {
  const appearance = useSettings((s) => s.appearance);
  const { palette, mode, overrides } = appearance;
  const [query, setQuery] = useState("");
  const [gallery, setGallery] = useState(false);
  const [editor, setEditor] = useState(false);
  const [transfer, setTransfer] = useState<"import" | "export" | null>(null);

  const selected = getPalette(palette);
  const tokens = useMemo(() => effectiveTokens({ palette, mode, overrides }), [palette, mode, overrides]);
  const shown = useMemo(() => {
    if (query.trim()) return searchPalettes(PALETTES, query);
    // The current palette always shows, even when it isn't a popular one.
    return FEATURED_PALETTES.some((p) => p.id === selected.id) ? FEATURED_PALETTES : [...FEATURED_PALETTES, selected];
  }, [query, selected]);
  const select = useCallback((id: string) => setAppearance({ palette: id }), []);
  const setMode = useCallback((m: Mode) => setAppearance({ mode: m }), []);
  const closeGallery = useCallback(() => setGallery(false), []);
  const customCount = Object.keys(overrides).length;

  return (
    <section className="mb-6 rounded-lg bg-[var(--c-surface)] p-6">
      <h2 className="mb-1 text-lg font-semibold">Appearance</h2>
      <p className="mb-4 text-sm text-[var(--c-text-muted)]">Color palette, custom colors and other visual options.</p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} />
        <ModeToggle mode={mode} onChange={setMode} />
      </div>
      {!hasMode(selected, mode) && (
        <p className="mb-3 text-sm text-[var(--c-text-muted)]">{selected.name} has no {mode} variant, so its other variant is used.</p>
      )}
      <h3 className="mb-2 text-sm font-medium text-[var(--c-text-muted)]">{query.trim() ? `${shown.length} found` : "Popular"}</h3>
      <PaletteGrid palettes={shown} mode={mode} selected={selected.id} onSelect={select} />
      <button className={`${outlineBtn} mt-4`} onClick={() => setGallery(true)}>
        <LayoutGrid size={16} aria-hidden /> Show all {PALETTES.length} palettes
      </button>

      <div className="mt-6 border-t border-[var(--c-outline)] pt-4">
        <button className="flex w-full items-center justify-between text-left" onClick={() => setEditor((v) => !v)} aria-expanded={editor}>
          <span>
            <span className="block font-medium">Custom colors</span>
            <span className="text-sm text-[var(--c-text-muted)]">
              {customCount ? `${customCount} custom ${customCount === 1 ? "color" : "colors"}, kept when you switch palettes.` : "Fine-tune any color on top of the palette."}
            </span>
          </span>
          <ChevronDown size={20} className={`shrink-0 transition-transform ${editor ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <div className="mt-3">
          <ContrastWarnings tokens={tokens} />
        </div>
        {editor && (
          <>
            <ColorEditor tokens={tokens} overrides={overrides} onChange={(o) => setAppearance({ overrides: o })} />
            <button className={`${outlineBtn} mt-4`} disabled={!customCount} onClick={() => setAppearance({ overrides: {} })}>
              <RotateCcw size={16} aria-hidden /> Discard all custom colors
            </button>
          </>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--c-outline)] pt-4">
        <button className={outlineBtn} onClick={() => setTransfer("import")}><Upload size={16} aria-hidden /> Import theme</button>
        <button className={outlineBtn} onClick={() => setTransfer("export")}><Download size={16} aria-hidden /> Export theme</button>
        <button className={`${outlineBtn} ml-auto`} onClick={() => useSettings.getState().set({ appearance: DEFAULT_APPEARANCE })}>
          <RotateCcw size={16} aria-hidden /> Restore default appearance
        </button>
      </div>

      {gallery && <PaletteGallery mode={mode} selected={selected.id} onSelect={select} onMode={setMode} onClose={closeGallery} />}
      {transfer && (
        <ThemeTransfer kind={transfer} current={appearance} onImport={(a) => useSettings.getState().set({ appearance: a })} onClose={() => setTransfer(null)} />
      )}
    </section>
  );
}
