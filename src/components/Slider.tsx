import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Thin track with a thumb that appears on hover/drag. `onChange` fires live while dragging
 * when `live` is set, otherwise only `onCommit` fires on release.
 */
export default function Slider({ value, max, onCommit, onChange, live = false, step, label, format, tooltip = "hover", disabled, className = "" }: {
  value: number;
  max: number;
  onCommit: (v: number) => void;
  onChange?: (v: number) => void;
  live?: boolean;
  step: number;
  label: string;
  format?: (v: number) => string;
  /** "hover" labels the point under the pointer (seek preview); "value" labels the current value (still placed at the pointer). */
  tooltip?: "hover" | "value";
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;

  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * max;
  };
  const move = (v: number) => {
    setDrag(v);
    if (live) (onChange ?? onCommit)(v);
  };
  const key = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
    if (!d) return;
    e.preventDefault();
    onCommit(Math.min(max, Math.max(0, value + d)));
  };

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={format?.(shown)}
      aria-disabled={disabled}
      onKeyDown={key}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(at(e));
      }}
      onPointerMove={(e) => {
        if (disabled) return;
        setHover(at(e));
        if (drag !== null) move(at(e));
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        onCommit(at(e));
        setDrag(null);
      }}
      onPointerLeave={() => setHover(null)}
      className={`group relative flex h-4 cursor-pointer touch-none items-center ${disabled ? "pointer-events-none opacity-40" : ""} ${className}`}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 group-hover:h-1.5">
        {hover !== null && max > 0 && <div className="absolute inset-0 origin-left bg-white/20" style={{ transform: `scaleX(${hover / max})` }} />}
        {/* scaleX instead of width: no layout on every clock tick */}
        <div className="absolute inset-0 origin-left bg-[var(--accent)]" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <div
        className={`absolute h-3 w-3 -translate-x-1/2 rounded-full bg-[var(--accent)] shadow ${drag !== null ? "block" : "hidden group-hover:block group-focus-visible:block"}`}
        style={{ left: `${pct}%` }}
      />
      {(hover !== null || drag !== null) && format && max > 0 && (
        <div className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-[var(--surface-3)] px-2 py-1 text-xs tabular-nums shadow whitespace-nowrap"
          style={{ left: `${((hover ?? shown) / max) * 100}%` }}>
          {format(tooltip === "value" ? shown : hover ?? shown)}
        </div>
      )}
    </div>
  );
}
