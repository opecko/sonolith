import { CircleCheck, History, Keyboard, Library, Loader2, LogIn, MousePointerClick, Palette as PaletteIcon, Sparkles, User } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { getAccount } from "../api/ytm";
import { ModeToggle, PaletteGrid } from "../components/appearance/PaletteGallery";
import { LAYOUTS, LayoutPreview, STYLES } from "../components/appearance/StyleOptions";
import { TransportSample } from "../components/PlayerBar";
import Select from "../components/Select";
import Slider from "../components/Slider";
import Switch from "../components/Switch";
import { UiStyleScope } from "../components/UiStyle";
import { useAsync } from "../hooks/useData";
import { KaraokeChoices } from "../lyrics/KaraokeSetting";
import { useAuth } from "../stores/auth";
import { setAppearance, useSettings } from "../stores/settings";
import { AMBIENT_QUALITIES, COVER_COLOR_OPTIONS, type UiStyle } from "../theme/appearance";
import { FEATURED } from "../theme/featured";
import { getPalette, PALETTES } from "../theme/palettes";
import logo from "../../src-tauri/icons/128x128@2x.png";

const FEATURED_PALETTES = FEATURED.map((id) => PALETTES.find((p) => p.id === id)).filter((p) => !!p);

/** A step's heading: focused when the step comes in, so screen readers start there. */
export function StepTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 tabIndex={-1} data-step-title="" className="type-headline-large-em outline-none max-sm:type-headline-medium-em">{children}</h1>
      {sub && <p className="type-body-large mt-2 text-[var(--m3-on-surface-variant)]">{sub}</p>}
    </header>
  );
}

function Option({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="type-title-medium">{title}</p>
        {detail && <p className="type-body-medium text-[var(--m3-on-surface-variant)]">{detail}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

const choice = (on: boolean) =>
  `m3-choice flex flex-col overflow-hidden rounded-[var(--m3-corner-lg)] border-2 text-left ${on ? "border-[var(--m3-primary)]" : "border-[var(--m3-outline-variant)] hover:bg-[color-mix(in_srgb,var(--m3-on-surface)_6%,transparent)]"}`;

export function Welcome() {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <img src={logo} alt="" width={96} height={96} className="mb-6 h-24 w-24" />
      <h1 tabIndex={-1} data-step-title="" className="type-display-small-em outline-none">Welcome to Sonolith</h1>
      <p className="type-body-large mt-3 max-w-md text-[var(--m3-on-surface-variant)]">
        YouTube Music on your desktop: your library, mixes and radio, with media keys and a look you can make your own.
      </p>
      <p className="type-body-medium mt-2 text-[var(--m3-on-surface-variant)]">Setup takes a minute. You can change everything later.</p>
    </div>
  );
}

function Account() {
  const { data } = useAsync("account", getAccount);
  return (
    <div className="flex items-center gap-4 rounded-[var(--m3-corner-lg)] bg-[var(--m3-secondary-container)] p-4 text-[var(--m3-on-secondary-container)]">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--m3-surface-container-highest)]">
        {data?.photo ? <img src={data.photo} alt="" className="h-full w-full object-cover" /> : <User size={22} aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="type-title-medium-em truncate">{data?.name ?? "Signed in"}</p>
        <p className="type-body-medium truncate opacity-80">{data?.handle ?? "Your library is ready."}</p>
      </div>
      <CircleCheck size={24} aria-label="Signed in" />
    </div>
  );
}

export function SignIn({ onContinue, busy, onSignIn }: { onContinue: () => void; busy: boolean; onSignIn: () => void }) {
  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const perks: [typeof Library, string][] = [
    [Library, "Your library, playlists and saved albums"],
    [Sparkles, "Mixes and recommendations made for you"],
    [History, "Your listening history, kept in sync"],
  ];
  return (
    <div>
      <StepTitle sub="Sonolith works without an account too, but it's at its best signed in.">Sign in to YouTube Music</StepTitle>
      <ul className="mb-6 flex flex-col gap-3">
        {perks.map(([Icon, text]) => (
          <li key={text} className="type-body-large flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]"><Icon size={20} aria-hidden /></span>
            {text}
          </li>
        ))}
      </ul>
      {status === "signedIn" ? <Account /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          <button className="m3-btn m3-filled h-12 justify-center" onClick={onSignIn} disabled={busy}>
            {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <LogIn size={18} aria-hidden />}
            {busy ? "Waiting for sign-in…" : "Sign in with Google"}
          </button>
          <button className="m3-btn m3-tonal h-12 justify-center" onClick={onContinue}>Continue without signing in</button>
        </div>
      )}
      {error && status !== "signedIn" && <p className="type-body-medium mt-3 text-[var(--m3-error)]" role="alert">{error}</p>}
      <p className="type-body-medium mt-4 text-[var(--m3-on-surface-variant)]">You can also sign in later from the avatar at the top right.</p>
    </div>
  );
}

/** A small sample drawn by the real components in one style: the transport, a slider and a switch (inert). */
function StyleSample({ id }: { id: UiStyle }) {
  return (
    <span aria-hidden className="pointer-events-none block" inert>
      <UiStyleScope value={id} className="flex h-36 flex-col items-center justify-center gap-4 bg-[var(--c-bg)] px-5">
        <TransportSample />
        <div className="flex w-full items-center gap-4">
          <Slider className="flex-1" value={0.6} max={1} step={0.05} label="Sample" onCommit={() => {}} size="sm" />
          <Switch on onChange={() => {}} label="Sample" />
        </div>
      </UiStyleScope>
    </span>
  );
}

export function StyleStep() {
  const uiStyle = useSettings((s) => s.appearance.uiStyle);
  return (
    <div>
      <StepTitle sub="Pick the look you like; it changes right away.">Choose a style</StepTitle>
      <div className="grid gap-4 sm:grid-cols-2" role="radiogroup" aria-label="Style">
        {STYLES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={uiStyle === s.id} className={choice(uiStyle === s.id)} onClick={() => setAppearance({ uiStyle: s.id })}>
            <StyleSample id={s.id} />
            <span className="block p-4">
              <span className="type-title-medium-em block">{s.label}{s.id === "m3" && <span className="type-label-medium ml-2 rounded-full bg-[var(--m3-tertiary-container)] px-2 py-0.5 text-[var(--m3-on-tertiary-container)]">New</span>}</span>
              <span className="type-body-medium mt-1 block text-[var(--m3-on-surface-variant)]">{s.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ColorsStep({ onMore }: { onMore: () => void }) {
  const { palette, mode, coverColors } = useSettings((s) => s.appearance);
  const selected = getPalette(palette);
  const shown = useMemo(() => (FEATURED_PALETTES.some((p) => p.id === selected.id) ? FEATURED_PALETTES : [...FEATURED_PALETTES, selected]), [selected]);
  return (
    <div>
      <StepTitle sub="A palette for the whole app, in dark or light.">Pick your colors</StepTitle>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ModeToggle mode={mode} onChange={(m) => setAppearance({ mode: m })} />
        <button className="m3-btn m3-text h-10" onClick={onMore}><PaletteIcon size={18} aria-hidden /> More palettes in Settings</button>
      </div>
      <PaletteGrid palettes={shown} mode={mode} selected={selected.id} onSelect={(id) => setAppearance({ palette: id })} />
      <div className="mt-4 border-t border-[var(--m3-outline-variant)] pt-2">
        <Option title="Colors from album art" detail="The colors follow the cover of what's playing, everywhere or only in Now Playing; your palette is used when there's no cover.">
          <Select value={coverColors} options={COVER_COLOR_OPTIONS} onChange={(v) => setAppearance({ coverColors: v })} label="Colors from album art" />
        </Option>
      </div>
    </div>
  );
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

export function NowPlayingStep() {
  const a = useSettings((s) => s.appearance);
  return (
    <div>
      <StepTitle sub="The full-screen view of the song that's playing.">Now Playing</StepTitle>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Now Playing layout">
        {LAYOUTS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={a.nowPlayingLayout === l.id} className={choice(a.nowPlayingLayout === l.id)} onClick={() => setAppearance({ nowPlayingLayout: l.id })}>
            <span className="block h-28 bg-[var(--c-bg)]" aria-hidden><LayoutPreview id={l.id} /></span>
            <span className="type-title-small-em block px-3 py-2">{l.label}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 border-t border-[var(--m3-outline-variant)] pt-2">
        <Option title="Ambient light" detail="A soft glow from the artwork behind Now Playing.">
          <Switch on={a.ambient} onChange={(ambient) => setAppearance({ ambient })} label="Ambient light" />
        </Option>
        {a.ambient && (
          <>
            <Option title="Intensity">
              <Slider className="w-40" value={a.ambientIntensity} max={1} step={0.05} live onCommit={(ambientIntensity) => setAppearance({ ambientIntensity })} label="Ambient intensity" tooltip="value" format={pct} />
            </Option>
            <Option title="Quality" detail="Higher is smoother; it's drawn once per song.">
              <div className="m3-segmented flex" role="group" aria-label="Ambient quality">
                {AMBIENT_QUALITIES.map((q) => (
                  <button key={q} type="button" className="m3-seg capitalize" aria-pressed={a.ambientQuality === q} onClick={() => setAppearance({ ambientQuality: q })}>{q}</button>
                ))}
              </div>
            </Option>
          </>
        )}
      </div>
    </div>
  );
}

export function LyricsStep() {
  const animations = useSettings((s) => s.appearance.animations);
  const on = useSettings((s) => s.lyricsEnabled);
  return (
    <div>
      <StepTitle sub="Song lyrics in Now Playing, following the music line by line and word by word.">Lyrics</StepTitle>
      <Option title="Show lyrics" detail="Off hides them and asks no lyrics provider.">
        <Switch on={on} onChange={(lyricsEnabled) => useSettings.getState().set({ lyricsEnabled })} label="Show lyrics" />
      </Option>
      <div className={`mt-2 border-t border-[var(--m3-outline-variant)] pt-4 ${on ? "" : "pointer-events-none opacity-50"}`} aria-disabled={!on}>
        <p className="type-title-medium">Karaoke style</p>
        <p className="type-body-medium mb-3 text-[var(--m3-on-surface-variant)]">
          How word-by-word lyrics show the sung words.{animations ? "" : " Animations are off, so every style shows as Simple."}
        </p>
        <KaraokeChoices
          card={(sel) => `m3-choice rounded-[var(--m3-corner-lg)] border-2 p-4 text-left ${sel ? "border-[var(--m3-primary)]" : "border-[var(--m3-outline-variant)] hover:bg-[color-mix(in_srgb,var(--m3-on-surface)_6%,transparent)]"}`}
          label={() => "type-title-small-em mb-2"} />
        <p className="type-body-medium mt-4 text-[var(--m3-on-surface-variant)]">Which lyrics providers to ask, and in what order, is in Settings → Lyrics.</p>
      </div>
    </div>
  );
}

export function Done() {
  const tips: [typeof Keyboard, string][] = [
    [MousePointerClick, "Right-click a song, album or playlist for more options."],
    [Keyboard, "Media keys work even while Sonolith is in the background."],
    [PaletteIcon, "Everything you just picked lives in Settings → Appearance."],
  ];
  return (
    <div className="flex flex-col items-center py-4 text-center">
      <span className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--m3-primary-container)] text-[var(--m3-on-primary-container)]"><CircleCheck size={40} aria-hidden /></span>
      <h1 tabIndex={-1} data-step-title="" className="type-display-small-em outline-none">You're all set</h1>
      <ul className="mt-6 flex max-w-md flex-col gap-3 text-left">
        {tips.map(([Icon, text]) => (
          <li key={text} className="type-body-large flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--m3-secondary-container)] text-[var(--m3-on-secondary-container)]"><Icon size={20} aria-hidden /></span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
