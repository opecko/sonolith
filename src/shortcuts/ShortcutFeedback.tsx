import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useShortcutUi } from "./store";

/** The volume a shortcut just set, for when no volume control is on screen (or it's out of sight). */
export default function ShortcutFeedback() {
  const volume = useShortcutUi((s) => s.volume);
  if (volume === null) return null;
  const level = Math.round(volume * 100);
  const Icon = level === 0 ? VolumeX : level < 50 ? Volume1 : Volume2;
  return (
    <div role="status" className="m3-snackbar pointer-events-none fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] px-4 py-2.5 text-sm tabular-nums shadow-2xl">
      <Icon size={18} aria-hidden /> Volume {level} %
    </div>
  );
}
