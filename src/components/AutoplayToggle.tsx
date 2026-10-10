import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import Switch from "./Switch";

/** YT Music-style "Autoplay" switch. */
export default function AutoplayToggle({ withLabel = true }: { withLabel?: boolean }) {
  const on = useSettings((s) => s.autoplay);
  const setAutoplay = usePlayer((s) => s.setAutoplay);
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--c-text-muted)]">
      {withLabel && <span aria-hidden>Autoplay</span>}
      <Switch on={on} onChange={setAutoplay} label="Autoplay" />
    </div>
  );
}
