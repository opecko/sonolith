import { RotateCcw } from "lucide-react";
import { setAppearance, useSettings } from "../../stores/settings";
import type { NowPlayingLayout, UiStyle } from "../../theme/appearance";
import Switch from "../Switch";

const STYLES: { id: UiStyle; label: string; detail: string }[] = [
  { id: "m3", label: "Material 3 Expressive", detail: "Rounder shapes, tonal colors, springy motion and buttons that change shape as you press them." },
  { id: "classic", label: "Classic", detail: "The ytdesk look from before 2.0: flat, compact, like YouTube Music." },
];

const LAYOUTS: { id: NowPlayingLayout; label: string }[] = [
  { id: "material", label: "Material" },
  { id: "bento", label: "Bento" },
  { id: "classic", label: "Classic" },
];

/** A tiny schematic of a Now Playing layout, drawn with the theme's own colors. */
function LayoutPreview({ id }: { id: NowPlayingLayout }) {
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

function Row({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{title}</p>
        {detail && <p className="text-sm text-[var(--c-text-muted)]">{detail}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

/** Style, Now Playing layout and animations (top of Settings → Appearance). */
export default function StyleOptions() {
  const uiStyle = useSettings((s) => s.appearance.uiStyle);
  const layout = useSettings((s) => s.appearance.nowPlayingLayout);
  const animations = useSettings((s) => s.appearance.animations);
  const seg = (on: boolean) => `m3-seg rounded-full px-3 py-1 text-sm ${on ? "bg-fg/15 font-medium" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`;
  const classic = uiStyle === "classic" && layout === "classic";
  return (
    <div className="mb-6 border-b border-[var(--c-outline)] pb-6" id="appearance-style">
      <Row title="Style" detail={STYLES.find((s) => s.id === uiStyle)!.detail}>
        <div className="m3-segmented flex rounded-full bg-fg/5 p-0.5" role="group" aria-label="Style">
          {STYLES.map((s) => (
            <button key={s.id} type="button" aria-pressed={uiStyle === s.id} className={seg(uiStyle === s.id)} onClick={() => setAppearance({ uiStyle: s.id })}>{s.label}</button>
          ))}
        </div>
      </Row>
      <div className="py-2">
        <p className="text-sm">Now Playing layout</p>
        <p className="mb-3 text-sm text-[var(--c-text-muted)]">Works with either style. Material and Bento have the queue, lyrics and related music built in.</p>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Now Playing layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={layout === l.id} onClick={() => setAppearance({ nowPlayingLayout: l.id })}
              className={`m3-choice flex w-40 flex-col overflow-hidden rounded-[var(--radius)] border text-left ${layout === l.id ? "border-[var(--c-accent)]" : "border-[var(--c-outline)] hover:bg-[var(--c-hover)]"}`}>
              <span className="block h-20 bg-[var(--c-bg)]" aria-hidden><LayoutPreview id={l.id} /></span>
              <span className={`px-3 py-2 text-sm ${layout === l.id ? "font-semibold" : ""}`}>{l.label}</span>
            </button>
          ))}
        </div>
      </div>
      <Row title="Animations" detail="Springs, shape changes and slides. Turn off to reduce motion; by default this follows your system's reduce motion setting.">
        <Switch on={animations} onChange={(on) => setAppearance({ animations: on })} label="Animations" />
      </Row>
      <div className="pt-2">
        <button className="m3-btn m3-text flex h-9 items-center gap-2 rounded-full px-3 text-sm text-[var(--c-text-muted)] hover:bg-[var(--c-hover)] disabled:opacity-50"
          disabled={classic} onClick={() => setAppearance({ uiStyle: "classic", nowPlayingLayout: "classic" })}>
          <RotateCcw size={16} aria-hidden /> Reset to classic ytdesk
        </button>
      </div>
    </div>
  );
}
