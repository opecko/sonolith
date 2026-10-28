import { ChevronDown, Download, Eye, LayoutGrid, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCoverScheme } from "../../stores/coverColors";
import { setAppearance, useSettings } from "../../stores/settings";
import { AMBIENT_QUALITIES, COVER_COLOR_OPTIONS, DEFAULT_APPEARANCE, type FontKind } from "../../theme/appearance";
import { FEATURED } from "../../theme/featured";
import { effectiveTokens } from "../../theme/index";
import { getPalette, hasMode, PALETTES } from "../../theme/palettes";
import { searchPalettes } from "../../theme/search";
import type { Mode } from "../../theme/types";
import { Segmented, SettingCard, SettingRow } from "../../views/settings/kit";
import Select from "../Select";
import Slider from "../Slider";
import Switch from "../Switch";
import ColorEditor, { ContrastWarnings, type EditorView } from "./ColorEditor";
import FontPicker from "./FontPicker";
import PaletteGallery, { ModeToggle, PaletteGrid, SearchField } from "./PaletteGallery";
import { AnimationsSwitch, LayoutPicker, ResetToClassic, StylePicker, styleDetail } from "./StyleOptions";
import ThemeTransfer from "./ThemeTransfer";
import type { VisualizerMode, VisualizerSettings } from "../../visualizer/settings";
import { VisualizerPreview } from "../../visualizer/Visualizer";
import { useAuth } from "../../stores/auth";
import { usePlayer } from "../../stores/player";
import { useUi } from "../../stores/ui";
import { useLibrary } from "../../stores/library";
import type { SaveAction, SaveButtonSettings } from "../../stores/saveButton";
import { isOwnPlaylist } from "../../stores/ownership";

const FEATURED_PALETTES = FEATURED.map((id) => PALETTES.find((p) => p.id === id)).filter((p) => !!p);

const FONT_OPTIONS: readonly (readonly [FontKind, string])[] = [["app", "Sonolith"], ["system", "System"], ["mono", "Monospace"], ["custom", "Installed"]];

const pct = (v: number) => `${Math.round(v * 100)} %`;

const outlineBtn = "m3-btn m3-outlined flex h-9 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)]";

/** Settings → Look: the style, motion, shapes, size and font. */
export function LookSettings() {
  const a = useSettings((s) => s.appearance);
  return (
    <>
      <SettingCard title="Style">
        <SettingRow id="style" title="Style" detail={styleDetail(a.uiStyle)}><StylePicker /></SettingRow>
        <SettingRow id="animations" title="Animations" detail="Springs, shape changes and slides. Off reduces motion; by default it follows your system's setting.">
          <AnimationsSwitch />
        </SettingRow>
        <SettingRow id="classic" title="Classic look" detail="Back to the look from before 2.0: Classic style and the Classic Now Playing.">
          <ResetToClassic />
        </SettingRow>
      </SettingCard>
      <SettingCard title="Size and shape">
        <SettingRow id="zoom" title="Interface size" detail="Scales everything: text, buttons and pictures.">
          {/* Slider covers 90–125 %; it works on the offset so the track starts at 90. */}
          <Slider className="w-40" value={a.zoom - 0.9} max={0.35} step={0.05} onCommit={(v) => setAppearance({ zoom: Math.round((0.9 + v) * 20) / 20 })} label="Interface size" tooltip="value" format={(v) => pct(0.9 + v)} />
        </SettingRow>
        <SettingRow id="density" title="Density" detail="Compact fits more on screen with less space around things.">
          <Segmented value={a.density} options={[["normal", "Normal"], ["compact", "Compact"]]} onChange={(density) => setAppearance({ density })} label="Density" />
        </SettingRow>
        <SettingRow id="radius" title="Corner radius" detail="How round buttons, cards and covers are.">
          <Slider className="w-40" value={a.radius} max={24} step={1} live onCommit={(radius) => setAppearance({ radius: Math.round(radius) })} label="Corner radius" tooltip="value" format={(v) => `${Math.round(v)} px`} />
        </SettingRow>
      </SettingCard>
      <SettingCard title="Text">
        <SettingRow id="font" title="Font" detail={a.font === "custom" && !a.fontFamily ? "Pick one of your installed fonts below." : "Sonolith's own font, your system's, or any font you have installed."}>
          <Segmented value={a.font} options={FONT_OPTIONS} onChange={(font) => setAppearance({ font })} label="Font" />
        </SettingRow>
        {a.font === "custom" && <div className="px-5 pb-4"><FontPicker value={a.fontFamily} onChange={(fontFamily) => setAppearance({ fontFamily })} /></div>}
      </SettingCard>
    </>
  );
}

/** Opens Now Playing with the layout switcher on top, to compare the layouts on the playing song. */
function TryLayouts() {
  const hasTrack = usePlayer((s) => s.index >= 0);
  return (
    <button className={`${outlineBtn} mt-3 disabled:opacity-50`} disabled={!hasTrack} title={hasTrack ? undefined : "Play something first"}
      onClick={() => {
        useUi.getState().setTryLooks("settings");
        useUi.getState().setNowPlaying(true);
      }}>
      <Eye size={18} aria-hidden /> Try them out
    </button>
  );
}

/** Settings → Now Playing: its layout, the ambient light behind it, the Save button and the visualizer. */
export function NowPlayingSettings() {
  const a = useSettings((s) => s.appearance);
  return (
    <>
      <SettingCard title="Layout">
        <SettingRow id="layout" title="Now Playing layout" detail="Material and Bento have the queue, lyrics and related music built in. All three work with either style." stacked>
          <LayoutPicker />
          <TryLayouts />
        </SettingRow>
      </SettingCard>
      <SettingCard title="Ambient light">
        <SettingRow id="ambient" title="Ambient light" detail="A soft glow from the cover behind Now Playing.">
          <Switch on={a.ambient} onChange={(ambient) => setAppearance({ ambient })} label="Ambient light" />
        </SettingRow>
        <SettingRow id="ambientIntensity" title="Intensity" disabled={!a.ambient}>
          <Slider className="w-40" value={a.ambientIntensity} max={1} step={0.05} live onCommit={(ambientIntensity) => setAppearance({ ambientIntensity })} label="Ambient intensity" tooltip="value" format={pct} />
        </SettingRow>
        <SettingRow id="ambientQuality" title="Quality" detail="Higher is smoother. It's drawn once per song, only while Now Playing is open." disabled={!a.ambient}>
          <Segmented value={a.ambientQuality} options={AMBIENT_QUALITIES.map((q) => [q, q[0].toUpperCase() + q.slice(1)] as const)} onChange={(ambientQuality) => setAppearance({ ambientQuality })} label="Ambient quality" />
        </SettingRow>
      </SettingCard>
      <SaveButtonCard />
      <VisualizerSettingsCard />
    </>
  );
}

const VISUALIZER_MODES: readonly (readonly [VisualizerMode, string])[] = [["off", "Off"], ["background", "Background"], ["cover", "On the cover"], ["halo", "Glow"]];
const VISUALIZER_DETAIL: Record<VisualizerMode, string> = {
  off: "Moves with the music in Now Playing. It only listens to Sonolith, never to other apps.",
  background: "Bars along the bottom of Now Playing, in the theme's color.",
  cover: "Bars over the bottom of the cover.",
  halo: "A glow around the cover that breathes with the bass.",
};

/** The audio visualizer's card on the Now Playing page. */
function VisualizerSettingsCard() {
  const v = useSettings((s) => s.visualizer);
  const animations = useSettings((s) => s.appearance.animations);
  const set = (patch: Partial<VisualizerSettings>) => useSettings.getState().set({ visualizer: { ...useSettings.getState().visualizer, ...patch } });
  const off = v.mode === "off" || !animations;
  return (
    <SettingCard title="Visualizer">
      <SettingRow id="visualizer" title="Visualizer"
        detail={animations ? VISUALIZER_DETAIL[v.mode] : "Needs animations, which are off (Settings → Look)."} stacked>
        {/* Each mode as a card with a live preview on made-up music, like the karaoke styles. */}
        <div role="radiogroup" aria-label="Visualizer" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {VISUALIZER_MODES.map(([mode, label]) => (
            <button key={mode} type="button" role="radio" aria-checked={v.mode === mode} onClick={() => set({ mode })}
              className={`m3-choice rounded-[var(--radius)] border p-2 text-left ${v.mode === mode ? "border-[var(--c-accent)]" : "border-[var(--c-outline)] hover:bg-[var(--c-hover)]"}`}>
              <p className={`mb-1.5 px-1 text-sm ${v.mode === mode ? "font-semibold" : ""}`}>{label}</p>
              <VisualizerPreview mode={mode} style={v.style} />
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow id="visualizerStyle" title="Shape" disabled={off || v.mode === "halo"}>
        <Segmented value={v.style} options={[["bars", "Bars"], ["wave", "Wave"]]} onChange={(style) => set({ style })} label="Visualizer shape" />
      </SettingRow>
      <SettingRow id="visualizerUnfocused" title="Keep moving in the background"
        detail="While another window has focus (say, on a second monitor) it keeps going at a lower frame rate. Minimized or hidden, it always stops."
        disabled={off}>
        <Switch on={v.unfocused} onChange={(unfocused) => set({ unfocused })} label="Keep moving in the background" />
      </SettingRow>
      <p className="px-5 pb-4 text-sm text-[var(--c-text-muted)]">
        While it's on screen, the visualizer listens to its own silent copy of the song, so playback itself is never
        touched. That copy streams too, so it uses some extra data.
      </p>
    </SettingCard>
  );
}

const SAVE_ACTIONS: readonly (readonly [SaveAction, string])[] = [["picker", "Choose each time"], ["direct", "One playlist"], ["off", "Off"]];
const SAVE_DETAIL: Record<SaveAction, string> = {
  picker: "A button next to like and dislike that lists your playlists to save the song to.",
  direct: "A button next to like and dislike that saves the song straight into the playlist below.",
  off: "No Save button; saving to a playlist stays in the ⋮ menu.",
};

/** Now Playing's Save button: what a click does, and the playlist for "One playlist". */
function SaveButtonCard() {
  const s = useSettings((st) => st.saveButton);
  const signedIn = useAuth((a) => a.status === "signedIn");
  const playlists = useLibrary((l) => l.playlists);
  const owners = useLibrary((l) => l.owners);
  useEffect(() => {
    if (signedIn && !useLibrary.getState().playlists) void useLibrary.getState().load();
  }, [signedIn]);
  const set = (patch: Partial<SaveButtonSettings>) => useSettings.getState().set({ saveButton: { ...useSettings.getState().saveButton, ...patch } });
  // Only the user's own playlists: saving into someone else's fails.
  const own = (playlists ?? []).filter((p) => isOwnPlaylist(p, owners));
  const options = [...(s.playlist ? [] : [{ value: "", label: "Choose a playlist" }]), ...own.map((p) => ({ value: p.id, label: p.title }))];
  // A chosen playlist that's gone from the library still shows, by its stored title, until another is picked.
  if (s.playlist && !own.some((p) => p.id === s.playlist!.id)) options.unshift({ value: s.playlist.id, label: s.playlist.title });
  return (
    <SettingCard title="Save button">
      <SettingRow id="saveButton" title="Save to playlist" detail={signedIn ? SAVE_DETAIL[s.action] : "Sign in to save songs to your playlists."}>
        <Segmented value={s.action} options={SAVE_ACTIONS} onChange={(action) => set({ action })} label="Save button" />
      </SettingRow>
      {s.action === "direct" && (
        <SettingRow id="saveButtonPlaylist" title="Playlist" detail={playlists ? (own.length ? undefined : "You have no playlists of your own yet.") : "Loading your playlists…"} disabled={!signedIn}>
          <Select value={s.playlist?.id ?? ""} options={options} label="Playlist for the Save button"
            onChange={(id) => {
              const p = own.find((x) => x.id === id);
              if (p) set({ playlist: { id: p.id, title: p.title } });
            }} />
        </SettingRow>
      )}
    </SettingCard>
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

/** Settings → Colors: palette, light or dark, colors from album art, custom colors, theme files. */
export function ColorSettings() {
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
  // With colors from album art, the contrast checks look at what's on screen: the cover's scheme plus overrides.
  const cover = useCoverScheme((s) => (appearance.coverColors === "app" ? s.tokens : null));
  const tokens = useMemo(() => effectiveTokens({ palette, mode, overrides }, cover ?? {}), [palette, mode, overrides, cover]);
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
    <>
      <SettingCard title="Palette">
        <SettingRow id="mode" title="Dark or light" detail={hasMode(selected, mode) ? `${selected.name} is the palette in use.` : `${selected.name} has no ${mode} variant, so its other variant is used.`}>
          <ModeToggle mode={mode} onChange={setMode} />
        </SettingRow>
        <SettingRow id="palette" title="Palette" detail="The colors of the whole app. Search by name or pick a popular one." stacked>
          <SearchField value={query} onChange={setQuery} />
          <h4 className="mb-2 mt-4 text-sm font-medium text-[var(--c-text-muted)]">{query.trim() ? `${shown.length} found` : "Popular"}</h4>
          <PaletteGrid palettes={shown} mode={mode} selected={selected.id} onSelect={select} />
          <button className={`${outlineBtn} mt-4`} onClick={() => setGallery(true)}>
            <LayoutGrid size={16} aria-hidden /> Show all {PALETTES.length} palettes
          </button>
        </SettingRow>
      </SettingCard>

      <SettingCard title="From the music">
        <SettingRow id="coverColors" title="Colors from album art" detail="Colors from the playing track's cover, for the whole app or only Now Playing. Without a cover the palette is used; your custom colors still apply on top.">
          <Select value={appearance.coverColors} options={COVER_COLOR_OPTIONS} onChange={(coverColors) => setAppearance({ coverColors })} label="Colors from album art" />
        </SettingRow>
      </SettingCard>

      <SettingCard title="Your own colors">
        <div data-setting="customColors" className="px-5 py-4">
          <button className="flex w-full items-center justify-between gap-4 text-left" onClick={() => setEditor((v) => !v)} aria-expanded={editor}>
            <span>
              <span className="block text-sm font-medium">Custom colors</span>
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
                <Segmented value={view} options={[["simple", "Simple"], ["advanced", "Advanced"]]} onChange={setView} label="Editor view" />
              </div>
              <ColorEditor view={view} tokens={tokens} overrides={overrides} onChange={(o) => setAppearance({ overrides: o })} />
              <button className={`${outlineBtn} mt-4`} disabled={!customCount} onClick={() => setAppearance({ overrides: {} })}>
                <RotateCcw size={16} aria-hidden /> Discard all custom colors
              </button>
            </>
          )}
        </div>
        <SettingRow id="themeFile" title="Theme file" detail="Share your look or bring in someone else's: palette, custom colors and the other appearance settings.">
          <button className={outlineBtn} onClick={() => setTransfer("import")}><Upload size={16} aria-hidden /> Import</button>
          <button className={outlineBtn} onClick={() => setTransfer("export")}><Download size={16} aria-hidden /> Export</button>
        </SettingRow>
        <SettingRow id="restoreAppearance" title="Restore default appearance" detail="Every Look, Colors and Now Playing setting back to how Sonolith comes.">
          <button className={outlineBtn} onClick={() => useSettings.getState().set({ appearance: DEFAULT_APPEARANCE })}>
            <RotateCcw size={16} aria-hidden /> Restore
          </button>
        </SettingRow>
      </SettingCard>

      {gallery && <PaletteGallery mode={mode} selected={selected.id} onSelect={select} onMode={setMode} onClose={closeGallery} />}
      {transfer && (
        <ThemeTransfer kind={transfer} current={appearance} onImport={(a) => useSettings.getState().set({ appearance: { ...a, animations: appearance.animations } })} onClose={() => setTransfer(null)} />
      )}
    </>
  );
}
