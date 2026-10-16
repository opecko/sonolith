import { Loader2, Play, Radio, Shuffle } from "lucide-react";
import type { RadioSource } from "../api/queue";
import type { Track } from "../api/types";
import { usePlayer } from "../stores/player";
import Thumb from "./Thumb";

export default function PageHeader({ title, subtitle, thumbnail, tracks, round, radio, playlistId }: {
  title: string; subtitle: string; thumbnail?: string; tracks?: Track[]; round?: boolean;
  /** Shows a "Radio" button next to Play/Shuffle. */
  radio?: RadioSource;
  /** Queue context so /next can return the list's own chips/continuation. */
  playlistId?: string;
}) {
  const startRadio = usePlayer((s) => s.startRadio);
  const radioPending = usePlayer((s) => s.radioPending === title);
  const playQueue = usePlayer((s) => s.playQueue);
  const shuffleOn = usePlayer((s) => s.shuffle);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  return (
    <header className="mb-8 flex items-end gap-8">
      <Thumb src={thumbnail} round={round} className="h-56 w-56 shrink-0 shadow-2xl" />
      <div className="min-w-0 pb-2">
        <h1 className="line-clamp-2 text-4xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 line-clamp-2 text-sm text-[var(--c-text-muted)]">{subtitle}</p>
        {(!!tracks?.length || radio) && (
          <div className="mt-6 flex gap-3">
            {!!tracks?.length && (<>
            <button onClick={() => playQueue(tracks, 0, { playlistId, title })}
              className="m3-btn m3-filled m3-medium flex h-10 items-center gap-2 rounded-full bg-button px-6 text-sm font-medium text-on-button hover:scale-105 active:scale-95">
              <Play size={20} fill="currentColor" aria-hidden /> Play
            </button>
            <button
              onClick={() => {
                if (!shuffleOn) toggleShuffle();
                playQueue(tracks, Math.floor(Math.random() * tracks.length), { playlistId, title });
              }}
              className="m3-btn m3-tonal m3-medium flex h-10 items-center gap-2 rounded-full border border-[var(--c-outline)] px-6 text-sm font-medium hover:bg-[var(--c-hover)]">
              <Shuffle size={20} aria-hidden /> Shuffle
            </button>
            </>)}
            {radio && (
              <button onClick={() => void startRadio(radio, title)} disabled={radioPending}
                className="m3-btn m3-tonal m3-medium flex h-10 items-center gap-2 rounded-full border border-[var(--c-outline)] px-6 text-sm font-medium hover:bg-[var(--c-hover)] disabled:opacity-60">
                {radioPending ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Radio size={20} aria-hidden />} Radio
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
