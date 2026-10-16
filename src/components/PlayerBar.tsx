import type { CSSProperties } from "react";
import {
  ChevronDown, ChevronUp, RotateCcw, RotateCw, Loader2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { usePlayer, type Repeat as RepeatMode } from "../stores/player";
import { useProgress } from "../stores/progress";
import { useUi } from "../stores/ui";
import { useUiStyle } from "./UiStyle";
import { useSettings } from "../stores/settings";
import type { Track } from "../api/types";
import { itemEntries, useTrackMenu } from "./ItemMenu";
import Menu from "./Menu";
import PlaybackError from "./PlaybackError";
import PodcastSpeed from "./PodcastSpeed";
import RatingButtons from "./RatingButtons";
import Slider from "./Slider";
import Thumb from "./Thumb";
import VolumeControl from "./VolumeControl";

export const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

const repeatLabel: Record<RepeatMode, string> = { off: "Repeat off", all: "Repeat all", one: "Repeat one" };

function MoreMenu() {
  const track = usePlayer((s) => s.queue[s.index]);
  return track ? <TrackMoreMenu key={track.id} track={track} /> : null;
}

export function TrackMoreMenu({ track, className = "h-10 w-10" }: { track: Track; className?: string }) {
  const { menu, loading, load } = useTrackMenu(track);
  return <Menu label="More actions" className={className} onOpen={load} entries={() => itemEntries(track, { menu, loading })} />;
}

function NowPlaying() {
  const { track, status, error } = usePlayer(useShallow((s) => ({ track: s.queue[s.index], status: s.status, error: s.error })));
  return (
    <div className="flex w-[30%] min-w-0 items-center gap-4">
      <button onClick={openNowPlaying} disabled={!track} aria-label="Open now playing" className="shrink-0 hover:opacity-80">
        <Thumb src={track?.thumbnail} px={48} className="h-12 w-12" />
      </button>
      <div className="min-w-0 flex-1">
        {track ? (
          <>
            <button onClick={openNowPlaying} className="block max-w-full truncate text-left text-sm font-medium hover:underline" title={track.title}>{track.title}</button>
            {error ? <PlaybackError error={error} /> : (
              <p className="truncate text-sm text-[var(--c-text-muted)]" title={byline(track)}>{status === "loading" ? "Loading…" : byline(track)}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--c-text-subtle)]">Nothing playing</p>
        )}
      </div>
      {track && (
        <>
          <RatingButtons track={track} />
          <MoreMenu />
        </>
      )}
    </div>
  );
}

export function SkipSeconds({ sec, onClick }: { sec: number; onClick: () => void }) {
  const Icon = sec < 0 ? RotateCcw : RotateCw;
  return (
    <button className="icon-btn relative h-10 w-10" onClick={onClick} aria-label={sec < 0 ? `Back ${-sec} seconds` : `Forward ${sec} seconds`}>
      <Icon size={28} strokeWidth={1.75} aria-hidden />
      <span className="absolute inset-0 flex items-center justify-center pt-0.5 text-[9px] font-bold">{Math.abs(sec)}</span>
    </button>
  );
}

function Controls() {
  const { status, shuffle, repeat, hasTrack, podcast } = usePlayer(
    useShallow((s) => ({ status: s.status, shuffle: s.shuffle, repeat: s.repeat, hasTrack: s.index >= 0, podcast: !!s.queue[s.index]?.podcast })),
  );
  const { togglePlay, next, prev, toggleShuffle, cycleRepeat, skipBy } = usePlayer.getState();
  const playing = status === "playing";
  const m3 = useUiStyle() === "m3";
  if (m3) return <M3Controls status={status} shuffle={shuffle} repeat={repeat} hasTrack={hasTrack} podcast={podcast} />;
  const playButton = (
    <button
      className="flex h-10 w-10 items-center justify-center rounded-full bg-button text-on-button hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
      onClick={togglePlay}
      disabled={!hasTrack}
      aria-label={playing ? "Pause" : "Play"}
    >
      {status === "loading" ? <Loader2 size={20} className="animate-spin" /> : playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
    </button>
  );
  // Podcast episodes: jump back 10 s / forward 30 s instead of previous / next, like YouTube Music.
  if (podcast)
    return (
      <div className="flex items-center gap-2">
        <SkipSeconds sec={-10} onClick={() => skipBy(-10)} />
        {playButton}
        <SkipSeconds sec={30} onClick={() => skipBy(30)} />
      </div>
    );
  return (
    <div className="flex items-center gap-2">
      <button className={`icon-btn h-10 w-10 ${shuffle ? "!text-[var(--c-text)]" : ""}`} onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle}>
        <Shuffle size={20} />
      </button>
      <button className="icon-btn h-10 w-10" onClick={prev} disabled={!hasTrack} aria-label="Previous">
        <SkipBack size={24} fill="currentColor" />
      </button>
      {playButton}
      <button className="icon-btn h-10 w-10" onClick={next} disabled={!hasTrack} aria-label="Next">
        <SkipForward size={24} fill="currentColor" />
      </button>
      <button className={`icon-btn h-10 w-10 ${repeat !== "off" ? "!text-[var(--c-text)]" : ""}`} onClick={cycleRepeat} aria-label={repeatLabel[repeat]} aria-pressed={repeat !== "off"}>
        {repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
      </button>
    </div>
  );
}

export const PlayIcon = ({ status, size }: { status: string; size: number }) =>
  status === "loading" ? <Loader2 size={size} className="animate-spin" /> : status === "playing" ? <Pause size={size} fill="currentColor" /> : <Play size={size} fill="currentColor" className="ml-0.5" />;

/**
 * M3 transport: toggle icon buttons for shuffle/repeat around a connected group (previous | play | next). The play
 * button is a pill while paused and morphs to a rounded square while playing (data-selected → --r-sel).
 */
export function M3Controls({ status, shuffle, repeat, hasTrack, podcast, size = "sm", split = false }: {
  status: string; shuffle: boolean; repeat: RepeatMode; hasTrack: boolean; podcast: boolean;
  /** "sm" = player bar, "md" = Bento's controls tile, "lg" = Now Playing. */
  size?: "sm" | "md" | "lg";
  /** Transport group on the left, shuffle and repeat on the opposite side (Now Playing). */
  split?: boolean;
}) {
  const { togglePlay, next, prev, toggleShuffle, cycleRepeat, skipBy } = usePlayer.getState();
  const playing = status === "playing";
  const lg = size === "lg", md = size === "md";
  const side = lg ? "h-14 w-16" : md ? "h-12 w-14" : "h-10 w-12";
  // Half the height (h-14 / h-12 / h-10, in spacing steps so compact density follows): the outer corners' full
  // radius, clamped so the inner corners keep theirs (m3-components.css).
  const pill = { "--pill": `calc(var(--spacing) * ${lg ? 7 : md ? 6 : 5})` } as CSSProperties;
  const icon = lg ? 28 : md ? 24 : 22;
  const toggle = `icon-btn m3-icon-toggle ${lg ? "h-12 w-12" : "h-10 w-10"}`;
  const play = lg ? "h-14 w-24" : md ? "h-12 w-20" : "h-10 w-16";
  const shuffleBtn = podcast ? <SkipSeconds sec={-10} onClick={() => skipBy(-10)} /> : (
    <button className={toggle} onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle}>
      <Shuffle size={lg ? 24 : 20} />
    </button>
  );
  const repeatBtn = podcast ? <SkipSeconds sec={30} onClick={() => skipBy(30)} /> : (
    <button className={toggle} onClick={cycleRepeat} aria-label={repeatLabel[repeat]} aria-pressed={repeat !== "off"}>
      {repeat === "one" ? <Repeat1 size={lg ? 24 : 20} /> : <Repeat size={lg ? 24 : 20} />}
    </button>
  );
  const group = (
      <div className="m3-connected flex items-center" role="group" aria-label="Playback">
        {!podcast && (
          <button className={`m3-btn m3-tonal m3-cg-start ${side} !px-0`} style={pill} onClick={prev} disabled={!hasTrack} aria-label="Previous">
            <SkipBack size={icon} fill="currentColor" />
          </button>
        )}
        <button className={`m3-btn m3-filled m3-play ${play} !px-0`} onClick={togglePlay} disabled={!hasTrack}
          data-selected={playing ? "" : undefined} aria-label={playing ? "Pause" : "Play"}>
          <PlayIcon status={status} size={lg ? 30 : md ? 26 : 22} />
        </button>
        {!podcast && (
          <button className={`m3-btn m3-tonal m3-cg-end ${side} !px-0`} style={pill} onClick={next} disabled={!hasTrack} aria-label="Next">
            <SkipForward size={icon} fill="currentColor" />
          </button>
        )}
      </div>
  );
  // Podcasts: −10 s / +30 s sit around play in both arrangements.
  if (split && !podcast)
    return (
      <div className="flex w-full items-center justify-between gap-3">
        {group}
        <div className="flex items-center gap-2">{shuffleBtn}{repeatBtn}</div>
      </div>
    );
  return (
    <div className={`flex items-center justify-center ${lg ? "gap-3" : "gap-2"} ${size === "sm" ? "" : "flex-wrap"}`}>
      {shuffleBtn}
      {group}
      {repeatBtn}
    </div>
  );
}

/** The only component subscribed to the playback clock. */
function Progress() {
  const position = useProgress((s) => s.position);
  const duration = useProgress((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  // M3: the wavy track while playing (flat when paused); Classic keeps its plain bar.
  const playing = usePlayer((s) => s.status === "playing");
  const m3 = useUiStyle() === "m3";
  return (
    <div className="flex w-full max-w-[600px] items-center gap-2 text-xs tabular-nums text-[var(--c-text-muted)]">
      <span className="w-10 text-right">{fmtTime(position)}</span>
      <Slider className="flex-1" value={position} max={duration} step={5} onCommit={seek} label="Seek" format={fmtTime} disabled={!duration} size="seek" wavy={m3 ? playing : undefined} />
      <span className="w-10">{fmtTime(duration)}</span>
    </div>
  );
}

const openNowPlaying = () => useUi.getState().setNowPlaying(true);

function NowPlayingToggle() {
  const open = useUi((s) => s.nowPlaying);
  const hasTrack = usePlayer((s) => s.index >= 0);
  return (
    <button className="icon-btn h-10 w-10" disabled={!hasTrack} onClick={() => useUi.getState().setNowPlaying(!open)}
      aria-label={open ? "Close now playing" : "Open now playing"} aria-expanded={open}>
      {open ? <ChevronDown size={24} /> : <ChevronUp size={24} />}
    </button>
  );
}

function PodcastSpeedSlot() {
  const podcast = usePlayer((s) => !!s.queue[s.index]?.podcast);
  return podcast ? <PodcastSpeed /> : null;
}

/** "Artist • Album" for the player, whatever list the track came from; the list's own subtitle only as a fallback. */
export function byline(t: Track): string {
  return [t.artists.join(", "), t.album?.title].filter(Boolean).join(" • ") || t.subtitle || "";
}

/** Hidden while Material or Bento Now Playing is open (they have all of this): the bar keeps its space, renders nothing. */
export default function PlayerBar() {
  const npOpen = useUi((s) => s.nowPlaying);
  const ownBar = useSettings((s) => s.appearance.nowPlayingLayout) !== "classic";
  const hidden = npOpen && ownBar;
  // Same height, so the (covered) content above doesn't lay out again; no children, so no clock subscriptions.
  if (hidden) return <footer aria-hidden className="h-[72px] shrink-0" />;
  return (
    <footer className="m3-playerbar relative z-40 flex h-[72px] shrink-0 items-center gap-6 border-t border-[var(--c-outline)] bg-[var(--c-surface)] px-4">
      <NowPlaying />
      <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
        <Controls />
        <Progress />
      </div>
      <div className="flex w-[30%] items-center justify-end gap-2">
        <PodcastSpeedSlot />
        <VolumeControl />
        <NowPlayingToggle />
      </div>
    </footer>
  );
}
