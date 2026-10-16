import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { hiResArt } from "../../api/art";
import type { Track } from "../../api/types";
import { useTrackMenu } from "../../components/ItemMenu";
import { fmtTime, M3Controls, TrackMoreMenu } from "../../components/PlayerBar";
import PodcastVideo from "../../components/PodcastVideo";
import RatingButtons from "../../components/RatingButtons";
import Slider from "../../components/Slider";
import { Spring } from "../../motion";
import { useNav } from "../../stores/nav";
import { usePlayer } from "../../stores/player";
import { useProgress } from "../../stores/progress";
import { useUi } from "../../stores/ui";

/** Building blocks of the M3 Now Playing layouts (Material, Bento). */

export const useCurrentTrack = () => usePlayer((s) => s.queue[s.index] as Track | undefined);

/** Hi-res artwork with a fallback to the list thumbnail; podcast episodes can show their video instead. */
export function CoverArt({ className = "" }: { className?: string }) {
  const track = useCurrentTrack();
  const video = useUi((s) => s.podcastVideo);
  const [failed, setFailed] = useState<string | null>(null);
  const hi = hiResArt(track?.thumbnail, track?.id);
  const src = hi && failed !== hi ? hi : track?.thumbnail;
  if (track?.podcast && video)
    return <div className={`flex items-center justify-center overflow-hidden bg-[var(--m3-scrim)] ${className}`}><PodcastVideo key={track.id} videoId={track.id} /></div>;
  return (
    <div className={`overflow-hidden bg-[var(--m3-surface-container-high)] ${className}`}>
      {src && <img key={src} src={src} alt="" referrerPolicy="no-referrer" onError={() => hi && setFailed(hi)} className="h-full w-full object-cover" draggable={false} />}
    </div>
  );
}

/** Audio / Video for podcast episodes, like YouTube Music (connected button group). */
export function PodcastMode() {
  const podcast = usePlayer((s) => !!s.queue[s.index]?.podcast);
  const video = useUi((s) => s.podcastVideo);
  if (!podcast) return null;
  return (
    <div className="m3-segmented flex" role="group" aria-label="Playback mode">
      {(["Audio", "Video"] as const).map((m) => (
        <button key={m} className="m3-seg" aria-pressed={(m === "Video") === video} onClick={() => useUi.getState().setPodcastVideo(m === "Video")}>{m}</button>
      ))}
    </div>
  );
}

/** Artist and album as links (artist from the track's menu, loaded once per track), plain text where there's none. */
export function TrackLinks({ track, className = "" }: { track: Track; className?: string }) {
  const { menu, load } = useTrackMenu(track);
  useEffect(load, [track.id]);
  const artistId = track.menu?.artistId ?? menu?.artistId;
  const go = useNav((s) => s.go);
  const artists = track.artists.join(", ") || track.subtitle;
  const link = "max-w-full truncate text-left hover:underline";
  return (
    <p className={`flex min-w-0 flex-wrap items-baseline gap-x-2 ${className}`}>
      {artistId ? <button className={link} onClick={() => go({ name: "artist", id: artistId })}>{artists}</button> : <span className="truncate">{artists}</span>}
      {track.album?.title && <span aria-hidden className="opacity-60">•</span>}
      {track.album?.title && (track.album.id
        ? <button className={link} onClick={() => go({ name: "album", id: track.album!.id! })}>{track.album.title}</button>
        : <span className="truncate">{track.album.title}</span>)}
    </p>
  );
}

/** Seek bar with "0:11 / 3:43"; the only part of a layout that re-renders on the clock (once a second). */
export function SeekBar({ className = "" }: { className?: string }) {
  const position = useProgress((s) => s.position);
  const duration = useProgress((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const playing = usePlayer((s) => s.status === "playing");
  return (
    <div className={className}>
      <Slider value={position} max={duration} step={5} onCommit={seek} label="Seek" format={fmtTime} disabled={!duration} size="seek" wavy={playing} />
      <p className="type-label-large mt-1 tabular-nums text-[var(--m3-on-surface-variant)]">{fmtTime(position)} / {fmtTime(duration)}</p>
    </div>
  );
}

/** Shuffle, previous, play/pause, next, repeat (or −10 s / +30 s for podcasts), Now Playing size. */
export function Transport({ split = false, size = "lg" }: { split?: boolean; size?: "md" | "lg" }) {
  const s = usePlayer(useShallow((s) => ({ status: s.status, shuffle: s.shuffle, repeat: s.repeat, hasTrack: s.index >= 0, podcast: !!s.queue[s.index]?.podcast })));
  return <M3Controls {...s} size={size} split={split} />;
}

/** Like / dislike and the track's ⋮ menu. */
export function TrackActions({ track }: { track: Track }) {
  return (
    <div className="flex shrink-0 items-center">
      <RatingButtons track={track} />
      <TrackMoreMenu key={track.id} track={track} />
    </div>
  );
}

const HIDDEN = -108;
/** Default spatial, damped a little more: the panel may settle with a small bounce but never swings far. */
const PANEL_SPRING = { damping: 0.85, stiffness: 380 };

/**
 * A panel that slides in from the left over its positioned parent on a spatial spring (transform written from the
 * frame loop, never a CSS transition). Mounted while open and until it has slid out.
 */
export function SlidePanel({ open, title, onClose, className = "", children }: {
  open: boolean; title: string; onClose: () => void; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const spring = useRef<Spring | null>(null);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Each mount starts outside (the style below) and slides in; closing slides out, then unmounts.
    spring.current ??= new Spring(HIDDEN, PANEL_SPRING, (x) => (el.style.transform = `translateX(${x}%)`));
    spring.current.to(open ? 0 : HIDDEN, () => {
      if (open) return;
      spring.current = null;
      setMounted(false);
    });
  }, [open, mounted]);
  useEffect(() => () => spring.current?.stop(), []);
  if (!mounted) return null;
  return (
    <section aria-label={title} aria-hidden={!open}
      className={`np-panel absolute z-20 flex flex-col overflow-hidden rounded-[var(--m3-corner-xl)] bg-[var(--m3-surface-container)] ${open ? "" : "pointer-events-none"} ${className}`}
      style={{ transform: `translateX(${HIDDEN}%)` }} ref={ref}>
      <header className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-4">
        <h2 className="type-title-large-em">{title}</h2>
        <button className="icon-btn h-10 w-10" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><X size={20} /></button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">{children}</div>
    </section>
  );
}
