import { Check, Gauge } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSettings } from "../stores/settings";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const fmtSpeed = (s: number) => `${s}×`;

/** Playback speed picker, shown in the player bar while a podcast episode plays. */
export default function PodcastSpeed() {
  const speed = useSettings((s) => s.podcastSpeed);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      if (e.type === "mousedown" && ref.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button className={`icon-btn h-10 gap-1 px-2 ${speed !== 1 ? "!text-[var(--c-text)]" : ""}`} onClick={() => setOpen((o) => !o)}
        aria-label={`Playback speed ${fmtSpeed(speed)}`} aria-haspopup="menu" aria-expanded={open}>
        <Gauge size={20} aria-hidden />
        {speed !== 1 && <span className="text-xs tabular-nums">{fmtSpeed(speed)}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute bottom-12 right-0 z-40 w-40 rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] py-2 shadow-2xl">
          <p className="px-4 pb-1 text-xs text-[var(--c-text-subtle)]">Playback speed</p>
          {SPEEDS.map((s) => (
            <button key={s} role="menuitemradio" aria-checked={s === speed}
              onClick={() => { useSettings.getState().set({ podcastSpeed: s }); setOpen(false); }}
              className="flex w-full items-center justify-between px-4 py-1.5 text-left text-sm tabular-nums hover:bg-[var(--c-hover)]">
              {s === 1 ? "Normal" : fmtSpeed(s)}
              {s === speed && <Check size={16} aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
