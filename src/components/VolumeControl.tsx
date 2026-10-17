import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { usePlayer } from "../stores/player";
import { useShortcutKey } from "../shortcuts/hint";
import Slider from "./Slider";

/** One volume step (±5 %, snapped to whole steps, 0–100 %); returns the new level. Wheel and keyboard shortcuts. */
export function stepVolume(dir: 1 | -1): number {
  const { volume, muted, setVolume } = usePlayer.getState();
  const base = muted ? 0 : volume;
  const v = Math.min(1, Math.max(0, Math.round((base + dir * 0.05) * 20) / 20));
  setVolume(v);
  return v;
}

/** Mouse wheel over a volume control. */
export function wheelVolume(deltaY: number) {
  if (deltaY) stepVolume(deltaY < 0 ? 1 : -1);
}

/**
 * The app's one volume control (player bar, Material and Bento Now Playing): a speaker icon that toggles mute and
 * shows the level, and a slider with the value in a tooltip. The mouse wheel over either changes it by 5 %.
 */
export default function VolumeControl({ sliderClassName = "w-24" }: { sliderClassName?: string }) {
  const { volume, muted } = usePlayer(useShallow((s) => ({ volume: s.volume, muted: s.muted })));
  const { setVolume, toggleMute } = usePlayer.getState();
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const up = useShortcutKey("volumeUp"), down = useShortcutKey("volumeDown");
  const keys = up && down ? ` · volume ${up} / ${down}` : "";
  return (
    <div className="flex items-center gap-1" onWheel={(e) => wheelVolume(e.deltaY)}>
      <button className="icon-btn h-10 w-10" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} title={`${muted ? "Unmute" : "Mute"}${keys}`}>
        <Icon size={20} />
      </button>
      <Slider className={sliderClassName} value={muted ? 0 : volume} max={1} step={0.05} live onCommit={setVolume} label="Volume" tooltip="value" size="sm" format={(v) => `${Math.round(v * 100)} %`} />
    </div>
  );
}
