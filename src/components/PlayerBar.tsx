import {
  ChevronDown, ChevronUp, ListMusic, RotateCcw, RotateCw, Loader2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { usePlayer, type Repeat as RepeatMode } from "../stores/player";
import { useProgress } from "../stores/progress";
import { useUi } from "../stores/ui";
import type { Track } from "../api/types";
import { itemEntries, useTrackMenu } from "./ItemMenu";
import Menu from "./Menu";
import PlaybackError from "./PlaybackError";
import PodcastSpeed from "./PodcastSpeed";
import RatingButtons from "./RatingButtons";
import Slider from "./Slider";
import Thumb from "./Thumb";

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

function TrackMoreMenu({ track }: { track: Track }) {
  const { menu, loading, load } = useTrackMenu(track);
  return <Menu label="More actions" className="h-10 w-10" onOpen={load} entries={() => itemEntries(track, { menu, loading })} />;
}

function NowPlaying() {
  const { track, status, error } = usePlayer(useShallow((s) => ({ track: s.queue[s.index], status: s.status, error: s.error })));
  return (
    <div className="flex w-[30%] min-w-0 items-center gap-4">
      <button onClick={openNowPlaying} disabled={!track} aria-label="Open now playing" className="shrink-0 hover:opacity-80">
        <Thumb src={track?.thumbnail} className="h-12 w-12" />
      </button>
      <div className="min-w-0 flex-1">
        {track ? (
          <>
            <button onClick={openNowPlaying} className="block max-w-full truncate text-left text-sm font-medium hover:underline" title={track.title}>{track.title}</button>
            {error ? <PlaybackError error={error} /> : (
              <p className="truncate text-sm text-[var(--text-2)]" title={byline(track)}>{status === "loading" ? "Loading…" : byline(track)}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--text-3)]">Nothing playing</p>
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

function SkipSeconds({ sec, onClick }: { sec: number; onClick: () => void }) {
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
  const playButton = (
    <button
      className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100"
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
      <button className={`icon-btn h-10 w-10 ${shuffle ? "!text-[var(--text-1)]" : ""}`} onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle}>
        <Shuffle size={20} />
      </button>
      <button className="icon-btn h-10 w-10" onClick={prev} disabled={!hasTrack} aria-label="Previous">
        <SkipBack size={24} fill="currentColor" />
      </button>
      {playButton}
      <button className="icon-btn h-10 w-10" onClick={next} disabled={!hasTrack} aria-label="Next">
        <SkipForward size={24} fill="currentColor" />
      </button>
      <button className={`icon-btn h-10 w-10 ${repeat !== "off" ? "!text-[var(--text-1)]" : ""}`} onClick={cycleRepeat} aria-label={repeatLabel[repeat]} aria-pressed={repeat !== "off"}>
        {repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
      </button>
    </div>
  );
}

/** The only component subscribed to the playback clock. */
function Progress() {
  const position = useProgress((s) => s.position);
  const duration = useProgress((s) => s.duration);
  const seek = usePlayer((s) => s.seek);
  return (
    <div className="flex w-full max-w-[600px] items-center gap-2 text-xs tabular-nums text-[var(--text-2)]">
      <span className="w-10 text-right">{fmtTime(position)}</span>
      <Slider className="flex-1" value={position} max={duration} step={5} onCommit={seek} label="Seek" format={fmtTime} disabled={!duration} />
      <span className="w-10">{fmtTime(duration)}</span>
    </div>
  );
}

function VolumeControl() {
  const { volume, muted } = usePlayer(useShallow((s) => ({ volume: s.volume, muted: s.muted })));
  const { setVolume, toggleMute } = usePlayer.getState();
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    // Mouse wheel over the icon or slider: ±5 %, snapped to whole steps.
    <div className="flex items-center gap-1" onWheel={(e) => {
      if (!e.deltaY) return;
      const base = muted ? 0 : volume;
      setVolume(Math.min(1, Math.max(0, Math.round((base + (e.deltaY < 0 ? 0.05 : -0.05)) * 20) / 20)));
    }}>
      <button className="icon-btn h-10 w-10" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted}>
        <Icon size={20} />
      </button>
      <Slider className="w-24" value={muted ? 0 : volume} max={1} step={0.05} live onCommit={setVolume} label="Volume" tooltip="value" format={(v) => `${Math.round(v * 100)} %`} />
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

export default function PlayerBar({ queueOpen, onToggleQueue }: { queueOpen: boolean; onToggleQueue: () => void }) {
  return (
    <footer className="flex h-[72px] shrink-0 items-center gap-6 border-t border-[var(--line)] bg-[var(--surface-1)] px-4">
      <NowPlaying />
      <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
        <Controls />
        <Progress />
      </div>
      <div className="flex w-[30%] items-center justify-end gap-2">
        <PodcastSpeedSlot />
        <VolumeControl />
        <button className={`icon-btn h-10 w-10 ${queueOpen ? "!text-[var(--text-1)] bg-[var(--hover)]" : ""}`} onClick={onToggleQueue} aria-label="Queue" aria-pressed={queueOpen}>
          <ListMusic size={20} />
        </button>
        <NowPlayingToggle />
      </div>
    </footer>
  );
}
