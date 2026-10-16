import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronDown } from "lucide-react";
import { hiResArt } from "../../api/art";
import PlaybackError from "../../components/PlaybackError";
import type { Track } from "../../api/types";
import { useTrackMenu } from "../../components/ItemMenu";
import { fmtTime, M3Controls, TrackMoreMenu } from "../../components/PlayerBar";
import PodcastVideo from "../../components/PodcastVideo";
import RatingButtons from "../../components/RatingButtons";
import Slider from "../../components/Slider";
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
  // Plain text flow with inline links: long names wrap like a sentence (two lines at most) instead of breaking
  // into one fragment per line.
  const link = "inline text-left hover:underline";
  return (
    <p className={`line-clamp-2 min-w-0 ${className}`}>
      {artistId ? <button className={link} onClick={() => go({ name: "artist", id: artistId })}>{artists}</button> : <span>{artists}</span>}
      {track.album?.title && <span aria-hidden className="opacity-60"> • </span>}
      {track.album?.title && (track.album.id
        ? <button className={link} onClick={() => go({ name: "album", id: track.album!.id! })}>{track.album.title}</button>
        : <span>{track.album.title}</span>)}
    </p>
  );
}

/** Seek bar with "0:11 / 3:43"; the only part of a layout that re-renders on the clock (once a second). */
export function SeekBar({ className = "", times = "inline" }: { className?: string; times?: "inline" | "split" }) {
  const position = useProgress((s) => s.position);
  const duration = useProgress((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  const playing = usePlayer((s) => s.status === "playing");
  return (
    <div className={className}>
      <Slider value={position} max={duration} step={5} onCommit={seek} label="Seek" format={fmtTime} disabled={!duration} size="seek" wavy={playing} />
      {times === "split" ? (
        <p className="type-label-large mt-1 flex justify-between tabular-nums text-[var(--m3-on-surface-variant)]"><span>{fmtTime(position)}</span><span>{fmtTime(duration)}</span></p>
      ) : (
        <p className="type-label-large mt-1 tabular-nums text-[var(--m3-on-surface-variant)]">{fmtTime(position)} / {fmtTime(duration)}</p>
      )}
    </div>
  );
}

/** Shuffle, previous, play/pause, next, repeat (or −10 s / +30 s for podcasts), Now Playing size. */
export function Transport({ split = false, size = "lg" }: { split?: boolean; size?: "md" | "lg" }) {
  const s = usePlayer(useShallow((s) => ({ status: s.status, shuffle: s.shuffle, repeat: s.repeat, hasTrack: s.index >= 0, podcast: !!s.queue[s.index]?.podcast })));
  return <M3Controls {...s} size={size} split={split} />;
}

/** The layout's only close button (M3 tonal icon button), bottom right where Material and Bento keep room for it. */
export function CloseNowPlaying() {
  return (
    <button className="icon-btn m3-icon-tonal h-12 w-12 shrink-0" onClick={() => useUi.getState().setNowPlaying(false)} aria-label="Close now playing" title="Close now playing">
      <ChevronDown size={24} />
    </button>
  );
}

/** Playback error or "Loading…" for the current track (the player bar's status line, for layouts without the bar). */
export function PlaybackStatus() {
  const { status, error } = usePlayer(useShallow((s) => ({ status: s.status, error: s.error })));
  if (error) return <PlaybackError error={error} />;
  return status === "loading" ? <p className="type-body-medium text-[var(--m3-on-surface-variant)]">Loading…</p> : null;
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
