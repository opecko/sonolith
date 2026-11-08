import { setAppearance, useSettings } from "../../stores/settings";
import type { NowPlayingLayout } from "../../theme/appearance";
import Switch from "../Switch";

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
