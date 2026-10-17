import { GripVertical, RotateCcw } from "lucide-react";
import Switch from "../components/Switch";
import { moveItem, useDragReorder } from "../hooks/useDragReorder";
import { useSettings } from "../stores/settings";
import { DEFAULT_LYRICS_PROVIDERS, PROVIDER_NAMES, type ProviderSetting } from "./providers";

const save = (lyricsProviders: ProviderSetting[]) => useSettings.getState().set({ lyricsProviders });

/**
 * Settings → Lyrics providers: drag (or Alt+↑ / Alt+↓) to set the priority, a switch per provider, reset to the
 * default order with all on. Reordering uses the Up next queue's mechanism (useDragReorder).
 */
export default function LyricsProviderSettings() {
  const list = useSettings((s) => s.lyricsProviders);
  const { ref, dropAt, dragFrom, onHandleDown, onHandleKey } = useDragReorder<HTMLOListElement>((from, to) => save(moveItem(useSettings.getState().lyricsProviders, from, to)));
  const isDefault = JSON.stringify(list) === JSON.stringify(DEFAULT_LYRICS_PROVIDERS);
  const allOff = list.every((p) => !p.enabled);
  return (
    <section id="settings-lyrics" className="m3-section mb-6 scroll-mt-4 rounded-lg bg-[var(--c-surface)] p-6">
      <div className="mb-1 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Lyrics providers</h2>
        <button className="icon-btn h-9 w-9" disabled={isDefault} onClick={() => save(DEFAULT_LYRICS_PROVIDERS)} aria-label="Reset lyrics providers" title="Default order, all on">
          <RotateCcw size={18} />
        </button>
      </div>
      <div className="m3-surface-card mt-3 rounded-[var(--radius)] border border-[var(--c-outline)] p-4">
        <p className="text-sm font-medium">Drag to reorder</p>
        <p className="mb-3 text-sm text-[var(--c-text-muted)]">Higher providers take priority. Turn all off to hide lyrics.</p>
        <ol ref={ref} className={dragFrom >= 0 ? "select-none" : ""}>
          {list.map((p, i) => (
            <li key={p.id} data-index={i}
              className={`relative flex items-center gap-3 rounded-[var(--radius)] py-1.5 pr-1 ${dragFrom === i ? "opacity-40" : ""}`}>
              {dropAt?.i === i && <span className={`pointer-events-none absolute inset-x-1 h-0.5 rounded bg-[var(--c-accent)] ${dropAt.pos === "before" ? "-top-px" : "-bottom-px"}`} />}
              <span role="button" tabIndex={0} aria-label={`Move ${PROVIDER_NAMES[p.id]} (drag, or Alt+Up / Alt+Down)`} title="Drag to reorder (Alt+↑ / Alt+↓)"
                onPointerDown={(e) => onHandleDown(i, e)} onKeyDown={(e) => onHandleKey(i, list.length, e)}
                className="flex h-9 w-7 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded text-[var(--c-text-subtle)] hover:text-[var(--c-text)] active:cursor-grabbing">
                <GripVertical size={18} aria-hidden />
              </span>
              <span className={`min-w-0 flex-1 truncate text-sm ${p.enabled ? "" : "text-[var(--c-text-muted)]"}`}>{PROVIDER_NAMES[p.id]}</span>
              <Switch on={p.enabled} label={PROVIDER_NAMES[p.id]} onChange={(on) => save(list.map((x) => (x.id === p.id ? { ...x, enabled: on } : x)))} />
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-3 text-sm text-[var(--c-text-muted)]">
        {allOff ? "Lyrics are hidden. " : ""}Enabled providers receive the title, artist, album and length of the song that plays; podcast episodes are never sent.
      </p>
    </section>
  );
}
