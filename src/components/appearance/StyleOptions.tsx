import { RotateCcw } from "lucide-react";
import { setAppearance, useSettings } from "../../stores/settings";
import type { NowPlayingLayout, UiStyle } from "../../theme/appearance";
import { Segmented } from "../../views/settings/kit";
import Switch from "../Switch";

export const STYLES: { id: UiStyle; label: string; detail: string }[] = [
  { id: "m3", label: "Material 3 Expressive", detail: "Rounder shapes, tonal colors, springy motion and buttons that change shape as you press them." },
  { id: "classic", label: "Classic", detail: "The look from before 2.0: flat, compact, like YouTube Music." },
];

export const LAYOUTS: { id: NowPlayingLayout; label: string }[] = [
  { id: "material", label: "Material" },
  { id: "bento", label: "Bento" },
  { id: "classic", label: "Classic" },
];

/** A tiny schematic of a Now Playing layout, drawn with the theme's own colors. */
export function LayoutPreview({ id }: { id: NowPlayingLayout }) {
  const tile = "rounded-[3px] bg-[var(--m3-surface-container-highest)]";
  const art = "rounded-[6px] bg-[var(--m3-primary-container)]";
  if (id === "material")
    return (
      <div className="flex h-full items-center gap-2 p-2">
        <div className={`${art} aspect-square h-[78%]`} />
        <div className="flex flex-1 flex-col gap-1">
          <div className="h-2 w-4/5 rounded-full bg-[var(--m3-on-surface)]" />
          <div className="h-1.5 w-1/2 rounded-full bg-[var(--m3-on-surface-variant)]" />
          <div className="mt-1 h-1 w-full rounded-full bg-[var(--m3-primary)]" />
          <div className="mt-1 flex gap-0.5"><div className="h-2.5 w-3 rounded-l-full bg-[var(--m3-secondary-container)]" /><div className="h-2.5 w-4 rounded-full bg-[var(--m3-primary)]" /><div className="h-2.5 w-3 rounded-r-full bg-[var(--m3-secondary-container)]" /></div>
        </div>
      </div>
    );
  if (id === "bento")
    return (
      <div className="grid h-full grid-cols-[1.2fr_1fr_0.8fr] grid-rows-3 gap-1 p-2">
        <div className={`${art} row-span-3`} />
        <div className={tile} />
        <div className={`${tile} row-span-3`} />
        <div className="rounded-[3px] bg-[var(--m3-secondary-container)]" />
        <div className="rounded-[3px] bg-[var(--m3-tertiary-container)]" />
      </div>
    );
  return (
    <div className="flex h-full items-center gap-2 p-2">
      <div className="flex flex-1 justify-center"><div className="h-[34px] w-[34px] rounded-[2px] bg-[var(--c-surface-2)]" /></div>
      <div className="flex w-[42%] flex-col gap-1">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-1.5 rounded-full bg-[var(--c-text-subtle)]" />)}
      </div>
    </div>
  );
}

/** The Style choice (Material 3 Expressive / Classic). */
export function StylePicker() {
  const uiStyle = useSettings((s) => s.appearance.uiStyle);
  return <Segmented value={uiStyle} options={STYLES.map((s) => [s.id, s.label] as const)} onChange={(id) => setAppearance({ uiStyle: id })} label="Style" />;
}

export const styleDetail = (id: UiStyle) => STYLES.find((s) => s.id === id)!.detail;

/** The Now Playing layout cards, each with a schematic. */
export function LayoutPicker() {
  const layout = useSettings((s) => s.appearance.nowPlayingLayout);
  return (
    <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Now Playing layout">
      {LAYOUTS.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={layout === l.id} onClick={() => setAppearance({ nowPlayingLayout: l.id })}
          className={`m3-choice flex w-40 flex-col overflow-hidden rounded-[var(--radius)] border text-left ${layout === l.id ? "border-[var(--c-accent)]" : "border-[var(--c-outline)] hover:bg-[var(--c-hover)]"}`}>
          <span className="block h-20 bg-[var(--c-bg)]" aria-hidden><LayoutPreview id={l.id} /></span>
          <span className={`px-3 py-2 text-sm ${layout === l.id ? "font-semibold" : ""}`}>{l.label}</span>
        </button>
      ))}
    </div>
  );
}

export function AnimationsSwitch() {
  const animations = useSettings((s) => s.appearance.animations);
  return <Switch on={animations} onChange={(on) => setAppearance({ animations: on })} label="Animations" />;
}

/** Back to the pre-2.0 look: Classic style and the Classic Now Playing. */
export function ResetToClassic() {
  const classic = useSettings((s) => s.appearance.uiStyle === "classic" && s.appearance.nowPlayingLayout === "classic");
  return (
    <button className="m3-btn m3-outlined flex h-9 items-center gap-2 rounded-full border border-[var(--c-outline)] px-4 text-sm hover:bg-[var(--c-hover)] disabled:opacity-50"
      disabled={classic} onClick={() => setAppearance({ uiStyle: "classic", nowPlayingLayout: "classic" })}>
      <RotateCcw size={16} aria-hidden /> Reset
    </button>
  );
}
