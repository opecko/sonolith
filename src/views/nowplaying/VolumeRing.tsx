import { Music, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { wheelVolume } from "../../components/PlayerBar";
import { usePlayer } from "../../stores/player";

const SIZE = 48;
const STROKE = 4;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * Circular volume control (Bento): the ring shows the level around a music note. Click toggles mute, the mouse
 * wheel and arrow keys change it by 5 %, dragging up or down changes it continuously; the percentage shows next
 * to it while it changes.
 */
export default function VolumeRing() {
  const { volume, muted } = usePlayer(useShallow((s) => ({ volume: s.volume, muted: s.muted })));
  const level = muted ? 0 : volume;
  const [changing, setChanging] = useState(false);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const drag = useRef<{ y: number; v: number; moved: boolean } | null>(null);
  const flash = () => {
    setChanging(true);
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setChanging(false), 1200);
  };
  useEffect(() => () => clearTimeout(hide.current), []);
  const set = (v: number) => {
    usePlayer.getState().setVolume(Math.min(1, Math.max(0, v)));
    flash();
  };
  const key = (e: KeyboardEvent) => {
    const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.05 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.05 : 0;
    if (d) {
      e.preventDefault();
      set(Math.round((level + d) * 20) / 20);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      usePlayer.getState().toggleMute();
    }
  };
  return (
    <div className="flex items-center gap-2">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        aria-valuetext={muted ? "Muted" : `${Math.round(level * 100)} %`}
        title={muted ? "Unmute" : "Mute (wheel or drag to change volume)"}
        className="m3-sl relative flex h-12 w-12 shrink-0 cursor-pointer touch-none items-center justify-center rounded-full text-[var(--m3-on-surface)]"
        onKeyDown={key}
        onWheel={(e) => {
          wheelVolume(e.deltaY);
          flash();
        }}
        onPointerDown={(e: PointerEvent) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v: level, moved: false };
        }}
        onPointerMove={(e: PointerEvent) => {
          const d = drag.current;
          if (!d) return;
          const dy = d.y - e.clientY;
          if (!d.moved && Math.abs(dy) < 3) return;
          d.moved = true;
          set(d.v + dy / 150);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) usePlayer.getState().toggleMute();
        }}
      >
        <svg width={SIZE} height={SIZE} className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--m3-secondary-container)" strokeWidth={STROKE} />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--m3-primary)" strokeWidth={STROKE} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - level)} opacity={level > 0 ? 1 : 0} />
        </svg>
        {muted ? <VolumeX size={20} aria-hidden /> : <Music size={20} aria-hidden />}
      </div>
      {/* Space kept so nothing shifts when it appears. */}
      <span className={`type-label-large w-14 tabular-nums text-[var(--m3-on-surface-variant)] ${changing ? "" : "invisible"}`} aria-hidden>{muted ? "Muted" : `${Math.round(level * 100)} %`}</span>
    </div>
  );
}
