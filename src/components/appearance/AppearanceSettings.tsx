import { ChevronDown, Download, LayoutGrid, RotateCcw, Upload } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { setAppearance, useSettings } from "../../stores/settings";
import { DEFAULT_APPEARANCE, type FontKind } from "../../theme/appearance";
import { FEATURED } from "../../theme/featured";
import { effectiveTokens } from "../../theme/index";
import { getPalette, hasMode, PALETTES } from "../../theme/palettes";
import { searchPalettes } from "../../theme/search";
import type { Mode } from "../../theme/types";
import Slider from "../Slider";
import Switch from "../Switch";
import ColorEditor, { ContrastWarnings, type EditorView } from "./ColorEditor";
import FontPicker from "./FontPicker";
import PaletteGallery, { ModeToggle, PaletteGrid, SearchField } from "./PaletteGallery";
import ThemeTransfer from "./ThemeTransfer";

const FEATURED_PALETTES = FEATURED.map((id) => PALETTES.find((p) => p.id === id)).filter((p) => !!p);

function OptionRow({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm">{title}</p>
        {detail && <p className="text-sm text-[var(--c-text-muted)]">{detail}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

const FONT_OPTIONS: [FontKind, string][] = [["app", "ytdesk"], ["system", "System"], ["mono", "Monospace"], ["custom", "Installed"]];

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Now Playing ambient, artwork accent, corners, density and UI size. */
function DisplayOptions() {
  const a = useSettings((s) => s.appearance);
  const seg = (on: boolean) => `rounded-full px-3 py-1 text-sm ${on ? "bg-fg/15 font-medium" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`;
  return (
    <div className="mt-6 border-t border-[var(--c-outline)] pt-4">
      <OptionRow title="Ambient light in Now Playing" detail="Soft glow from the artwork behind Now Playing.">
        <Switch on={a.ambient} onChange={(ambient) => setAppearance({ ambient })} label="Ambient light in Now Playing" />
      </OptionRow>
      {a.ambient && (
        <OptionRow title="Ambient intensity">
          <Slider className="w-40" value={a.ambientIntensity} max={1} step={0.05} live onCommit={(ambientIntensity) => setAppearance({ ambientIntensity })} label="Ambient intensity" tooltip="value" format={pct} />
        </OptionRow>
      )}
      <OptionRow title="Accent from artwork" detail="Takes the accent color from the playing track's cover.">
        <Switch on={a.coverAccent} onChange={(coverAccent) => setAppearance({ coverAccent })} label="Accent from artwork" />
      </OptionRow>
      <OptionRow title="Corner radius">
        <Slider className="w-40" value={a.radius} max={24} step={1} live onCommit={(radius) => setAppearance({ radius: Math.round(radius) })} label="Corner radius" tooltip="value" format={(v) => `${Math.round(v)} px`} />
      </OptionRow>
      <OptionRow title="Density">
        <div className="flex rounded-full bg-fg/5 p-0.5" role="group" aria-label="Density">
          <button type="button" aria-pressed={a.density === "normal"} className={seg(a.density === "normal")} onClick={() => setAppearance({ density: "normal" })}>Normal</button>
          <button type="button" aria-pressed={a.density === "compact"} className={seg(a.density === "compact")} onClick={() => setAppearance({ density: "compact" })}>Compact</button>
        </div>
      </OptionRow>
      <OptionRow title="Interface size">
        {/* Slider covers 90–125 %; it works on the offset so the track starts at 90. */}
        <Slider className="w-40" value={a.zoom - 0.9} max={0.35} step={0.05} onCommit={(v) => setAppearance({ zoom: Math.round((0.9 + v) * 20) / 20 })} label="Interface size" tooltip="value" format={(v) => pct(0.9 + v)} />
      </OptionRow>
      <OptionRow title="Font" detail={a.font === "custom" && !a.fontFamily ? "Pick one of your installed fonts below." : undefined}>
        <div className="flex rounded-full bg-fg/5 p-0.5" role="group" aria-label="Font">
          {FONT_OPTIONS.map(([kind, label]) => (
            <button key={kind} type="button" aria-pressed={a.font === kind} className={seg(a.font === kind)} onClick={() => setAppearance({ font: kind })}>{label}</button>
          ))}
        </div>
      </OptionRow>
      {a.font === "custom" && <FontPicker value={a.fontFamily} onChange={(fontFamily) => setAppearance({ fontFamily })} />}
    </div>
  );
}

const VIEW_KEY = "colorEditorView";
function readView(): EditorView {
  try {
    return localStorage.getItem(VIEW_KEY) === "advanced" ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

const outlineBtn = "flex h-9 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)]";

export default function AppearanceSettings() {
  const appearance = useSettings((s) => s.appearance);
  const { palette, mode, overrides } = appearance;
  const [query, setQuery] = useState("");
  const [gallery, setGallery] = useState(false);
  const [editor, setEditor] = useState(false);
  const [view, setViewState] = useState<EditorView>(readView);
  const setView = (v: EditorView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };
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
          <ChevronDown size={20} className={`shrink-0 ${editor ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <div className="mt-3">
          <ContrastWarnings tokens={tokens} />
        </div>
        {editor && (
          <>
            <div className="mb-2 flex items-center justify-between gap-4">
              <p className="text-sm text-[var(--c-text-muted)]">
                {view === "simple" ? "The main colors; related shades follow them." : "Every color the app uses."}
              </p>
              <div className="flex shrink-0 rounded-full bg-fg/5 p-0.5" role="group" aria-label="Editor view">
                {(["simple", "advanced"] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                    className={`rounded-full px-3 py-1 text-sm capitalize ${view === v ? "bg-fg/15 font-medium" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <ColorEditor view={view} tokens={tokens} overrides={overrides} onChange={(o) => setAppearance({ overrides: o })} />
            <button className={`${outlineBtn} mt-4`} disabled={!customCount} onClick={() => setAppearance({ overrides: {} })}>
              <RotateCcw size={16} aria-hidden /> Discard all custom colors
            </button>
          </>
        )}
      </div>

      <DisplayOptions />

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
