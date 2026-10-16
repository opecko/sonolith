import { useRef, useState } from "react";
import { useSpring } from "../motion";
import { useUiStyle } from "./UiStyle";

interface SwitchProps { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }

export default function Switch(props: SwitchProps) {
  return useUiStyle() === "m3" ? <M3Switch {...props} /> : <ClassicSwitch {...props} />;
}

// Sizes in px, not Tailwind spacing steps: compact density shrinks --spacing, which would shrink the track but not
// the knob's travel (the knob ended up outside the track).
function ClassicSwitch({ on, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative block h-[20px] w-[36px] shrink-0 rounded-full p-0 transition-colors duration-150 disabled:opacity-50 ${on ? "bg-[var(--c-accent)]" : "bg-fg/25"}`}
    >
      {/* The knob moves with `left`, not a transform: WebKitGTK composites transform transitions and paints the old
          position for a frame when one ends. Layout-driven, it stays on the main thread. */}
      <span className={`absolute top-[2px] block h-[16px] w-[16px] rounded-full shadow transition-[left,background-color] duration-150 ease-out ${on ? "left-[18px] bg-on-accent" : "left-[2px] bg-fg"}`} />
    </button>
  );
}

const pct = (p: number) => `${Math.round(Math.min(1, Math.max(0, p)) * 1000) / 10}%`;

/**
 * M3 switch, 52 × 32 px in every density. One spring (0 = off, 1 = on) drives the handle's position, its size
 * (16 → 24) and all colors (track, outline, handle) per frame, so they move as one; pressing grows the handle
 * toward 28 on a second, quick spring. Nothing uses CSS transitions; with animations off it jumps to the end.
 */
function M3Switch({ on, onChange, label, disabled }: SwitchProps) {
  const track = useRef<HTMLButtonElement>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const [pressed, setPressed] = useState(false);
  const st = useRef({ p: on ? 1 : 0, press: 0 });
  const paint = () => {
    const t = track.current, k = knob.current;
    if (!t || !k) return;
    const { p, press } = st.current;
    const d = 16 + 8 * p + (28 - 16 - 8 * Math.min(1, Math.max(0, p))) * press;
    const cx = 16 + 20 * p;
    k.style.width = k.style.height = `${d}px`;
    k.style.left = `${cx - d / 2}px`;
    k.style.top = `${16 - d / 2}px`;
    t.style.backgroundColor = `color-mix(in srgb, var(--m3-primary) ${pct(p)}, var(--m3-surface-container-highest))`;
    t.style.boxShadow = `inset 0 0 0 2px color-mix(in srgb, var(--m3-outline) ${pct(1 - p)}, transparent)`;
    k.style.backgroundColor = `color-mix(in srgb, var(--m3-on-primary) ${pct(p)}, var(--m3-outline))`;
  };
  useSpring(on ? 1 : 0, "fastSpatial", (p) => {
    st.current.p = p;
    paint();
  });
  useSpring(pressed ? 1 : 0, "fastEffects", (press) => {
    st.current.press = press;
    paint();
  });
  return (
    <button
      ref={track}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className="m3-switch relative block h-[32px] w-[52px] shrink-0 rounded-full p-0 disabled:opacity-40"
    >
      <span ref={knob} className="absolute block rounded-full" />
    </button>
  );
}
