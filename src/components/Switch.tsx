export default function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative block h-5 w-9 shrink-0 rounded-full p-0 transition-colors duration-150 disabled:opacity-50 ${on ? "bg-[var(--c-accent)]" : "bg-fg/25"}`}
    >
      {/* The knob moves with `left`, not a transform: WebKitGTK composites transform transitions and paints the old
          position for a frame when one ends. Layout-driven, it stays on the main thread. */}
      <span className={`absolute top-0.5 block h-4 w-4 rounded-full shadow transition-[left,background-color] duration-150 ease-out ${on ? "left-[18px] bg-on-accent" : "left-0.5 bg-fg"}`} />
    </button>
  );
}
