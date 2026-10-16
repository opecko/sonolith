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

/**
 * M3 switch: 52 × 32 track; the handle grows from 16 (off) to 24 (on) and 28 while pressed, its position and size
 * on a fast spatial spring (layout properties written per frame, no transforms).
 */
function M3Switch({ on, onChange, label, disabled }: SwitchProps) {
  const knob = useRef<HTMLSpanElement>(null);
  const [pressed, setPressed] = useState(false);
  const pos = useRef({ cx: on ? 36 : 16, d: on ? 24 : 16 });
  const paint = () => {
    const el = knob.current;
    if (!el) return;
    const { cx, d } = pos.current;
    el.style.width = el.style.height = `${d}px`;
    el.style.left = `${cx - d / 2}px`;
    el.style.top = `${16 - d / 2}px`;
  };
  useSpring(on ? 36 : 16, "fastSpatial", (cx) => {
    pos.current.cx = cx;
    paint();
  });
  useSpring(pressed ? 28 : on ? 24 : 16, "fastSpatial", (d) => {
    pos.current.d = d;
    paint();
  });
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={`m3-switch relative block h-[32px] w-[52px] shrink-0 rounded-full p-0 disabled:opacity-40 ${on ? "m3-switch-on" : ""}`}
    >
      <span ref={knob} className="m3-switch-handle absolute block rounded-full" />
    </button>
  );
}
