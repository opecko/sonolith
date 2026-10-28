import { Maximize2, Minimize2, MicVocal, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useShallow } from "zustand/react/shallow";
import AutoplayToggle from "../../components/AutoplayToggle";
import PlaybackError from "../../components/PlaybackError";
import { PlayIcon, SkipSeconds } from "../../components/PlayerBar";
import PodcastSpeed from "../../components/PodcastSpeed";
import VolumeControl from "../../components/VolumeControl";
import { QueueChips } from "../../components/QueueChips";
import Thumb from "../../components/Thumb";
import { Byline } from "../../components/TrackByline";
import { useTransportTitles } from "../../shortcuts/hint";
import { UiStyleScope } from "../../components/UiStyle";
import { Spring, useSwap } from "../../motion";
import { usePlayer, type Repeat as RepeatMode } from "../../stores/player";
import { CloseNowPlaying, CoverArt, PodcastMode, SeekBar, TrackActions, TrackLinks, useCurrentTrack } from "./parts";
import LyricsView from "../../lyrics/LyricsView";
import { LyricsTab, RelatedTab, UpNextTab, useTrackExtras } from "./shared";

function Tile({ area, className = "", children, label }: { area: string; className?: string; children: ReactNode; label?: string }) {
  return <section aria-label={label} className={`bento-tile np-glass bento-${area} ${className}`}>{children}</section>;
}

/** Opens with a small spring "pop" (scale + opacity written per frame from the shared loop). */
function usePop<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = new Spring(0, { damping: 0.8, stiffness: 520 }, (p) => {
      el.style.opacity = String(Math.min(1, Math.max(0, p)));
      el.style.transform = `scale(${0.96 + 0.04 * p})`;
    });
    s.set(0);
    s.to(1, () => {
      el.style.opacity = "";
      el.style.transform = "";
    });
    return () => s.stop();
  }, []);
  return ref;
}

/** As many of the next tracks as fit; a click plays one. */
function QueuePreview() {
  // The queue array itself (stable until it changes), sliced here: a selector returning a new slice every time
  // would never compare equal.
  const { queue, index } = usePlayer(useShallow((s) => ({ queue: s.queue, index: s.index })));
  const next = useMemo(() => queue.slice(index + 1, index + 31), [queue, index]);
  if (!next.length) return <p className="type-body-medium px-1 text-[var(--m3-on-surface-variant)]">Nothing queued after this one.</p>;
  return (
    <ol className="flex flex-col gap-0.5">
      {next.map((t, i) => (
        <li key={`${t.id}:${i}`} className="m3-row group relative flex items-center gap-3 p-1.5">
          <span className="relative shrink-0">
            <Thumb src={t.thumbnail} px={40} className="h-10 w-10" />
            <span className="m3-art absolute inset-0 hidden items-center justify-center bg-scrim/60 text-on-scrim group-hover:flex"><Play size={16} fill="currentColor" aria-hidden /></span>
          </span>
          <span className="min-w-0 flex-1">
            {/* Covers the row (row-hit); the artist and album names are links above it. */}
            <button className="row-hit type-body-large block max-w-full truncate text-left" onClick={() => usePlayer.getState().playIndex(index + 1 + i)}>{t.title}</button>
            <span className="row-above type-body-medium block truncate text-[var(--m3-on-surface-variant)]"><Byline track={t} text={t.artists.join(", ") || t.subtitle} /></span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The lyrics in a tile: synced ones follow the song (the current line near the top), plain ones fade out. */
function LyricsPreview() {
  return (
    <div className="bento-lyrics-text no-scrollbar min-h-0 flex-1 overflow-y-auto" style={{ maskImage: "linear-gradient(180deg, #000 55%, transparent)" }}>
      <LyricsView size="preview" />
    </div>
  );
}

const repeatLabel: Record<RepeatMode, string> = { off: "Repeat off", all: "Repeat all", one: "Repeat one" };

/**
 * Five equally tall rounded-square tonal buttons filling the row: shuffle, previous, a wide play/pause pill (a
 * rounded square while playing), next, repeat. Podcasts get −10 s / +30 s instead of shuffle and repeat.
 */
function BentoTransport() {
  const { status, shuffle, repeat, hasTrack, podcast } = usePlayer(
    useShallow((s) => ({ status: s.status, shuffle: s.shuffle, repeat: s.repeat, hasTrack: s.index >= 0, podcast: !!s.queue[s.index]?.podcast })),
  );
  const { togglePlay, next, prev, toggleShuffle, cycleRepeat, skipBy } = usePlayer.getState();
  const playing = status === "playing";
  const titles = useTransportTitles();
  const sq = "m3-btn m3-tonal bento-sq h-full min-w-0 flex-1 !px-0";
  return (
    <div className="bento-transport flex items-stretch gap-2" role="group" aria-label="Playback">
      {podcast ? <span className="flex flex-1 items-center justify-center"><SkipSeconds sec={-10} onClick={() => skipBy(-10)} /></span> : (
        <button className={sq} onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle}><Shuffle size={22} /></button>
      )}
      <button className={sq} onClick={prev} disabled={!hasTrack} aria-label="Previous" title={titles.prev}><SkipBack size={24} fill="currentColor" /></button>
      <button className="m3-btn m3-filled m3-play bento-play h-full min-w-0 flex-[2] !px-0" onClick={togglePlay} disabled={!hasTrack}
        data-selected={playing ? "" : undefined} aria-label={playing ? "Pause" : "Play"} title={titles.play(playing)}>
        {status === "loading" ? <PlayIcon status={status} size={28} /> : playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
      </button>
      <button className={sq} onClick={next} disabled={!hasTrack} aria-label="Next" title={titles.next}><SkipForward size={24} fill="currentColor" /></button>
      {podcast ? <span className="flex flex-1 items-center justify-center"><SkipSeconds sec={30} onClick={() => skipBy(30)} /></span> : (
        <button className={sq} onClick={cycleRepeat} aria-label={repeatLabel[repeat]} aria-pressed={repeat !== "off"}>
          {repeat === "one" ? <Repeat1 size={22} /> : <Repeat size={22} />}
        </button>
      )}
    </div>
  );
}

function Expanded({ onClose }: { onClose: () => void }) {
  const ref = usePop();
  const { videoId, lyrics } = useTrackExtras();
  const title = "Lyrics";
  return (
    <section ref={ref} aria-label={title} className="bento-tile np-glass bento-main flex min-h-0 flex-col">
      <header className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h2 className="type-title-large-em">{title}</h2>
        <button className="m3-btn m3-tonal h-10" onClick={onClose}><Minimize2 size={18} aria-hidden /> Collapse</button>
      </header>
      {videoId && lyrics && <div className="scroll-y min-h-0 flex-1 pr-1"><LyricsTab key={videoId} /></div>}
    </section>
  );
}

/** The queue's two panes, memoized: switching Up next ↔ Related re-renders neither. */
const UpNextPane = memo(function UpNextPane({ open }: { open: boolean }) {
  return open ? <div className="flex min-h-0 flex-1 flex-col"><UpNextTab /></div> : <div className="min-h-0 flex-1 overflow-hidden"><QueuePreview /></div>;
});
const RelatedPane = memo(RelatedTab);

type QueueView = "upnext" | "related";

/**
 * Up next | Related in one tile. Its own component, so a switch re-renders only this tile's header. Both panes stay
 * mounted once shown and only their visibility flips (stacked in one grid cell: a switch lays nothing out and
 * mounts nothing); Related (whole shelves of cards) mounts hidden first and the switch waits two frames, so that
 * work never lands in the animation's frames. `open` is the big tile (like expanded lyrics, everything but the
 * cover), a separate instance; the chosen tab lives in the layout so it carries over.
 */
const QueueTile = memo(function QueueTile({ open, onToggle, tab, setTab, tileRef }: {
  open: boolean;
  onToggle: () => void;
  tab: QueueView;
  setTab: (v: QueueView) => void;
  tileRef?: RefObject<HTMLElement | null>;
}) {
  const { videoId, related } = useTrackExtras();
  const queueLeft = usePlayer((s) => Math.max(0, s.queue.length - s.index - 1));
  const view = tab === "related" && !related ? "upnext" : tab;
  const swap = useSwap(view, view === "related" ? 1 : -1);
  const [relatedMounted, setRelatedMounted] = useState(view === "related");
  const setView = (v: QueueView) => {
    if (v === "related" && !relatedMounted) {
      setRelatedMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setTab("related")));
    } else setTab(v);
  };
  return (
    <section ref={tileRef} aria-label={view === "related" ? "Related" : "Up next"} className={`bento-tile np-glass ${open ? "bento-main" : "bento-queue"} flex min-h-0 flex-col overflow-hidden`}>
      <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="m3-segmented flex" role="tablist" aria-label="Up next or related">
          <button role="tab" className="m3-seg" aria-pressed={view === "upnext"} aria-selected={view === "upnext"} onClick={() => setView("upnext")}>
            Up next{queueLeft ? <span className="opacity-70">{queueLeft}</span> : null}
          </button>
          {related && <button role="tab" className="m3-seg" aria-pressed={view === "related"} aria-selected={view === "related"} onClick={() => setView("related")}>Related</button>}
        </div>
        <button className="icon-btn m3-icon-tonal h-10 w-10" onClick={onToggle} aria-expanded={open} aria-label={open ? "Collapse" : "Show all"} title={open ? "Collapse" : "Show all"}>
          {open ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </header>
      <div ref={swap} role="tabpanel" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] [&>*]:[grid-area:1/1]">
        <div className={`flex min-h-0 flex-col ${view === "upnext" ? "" : "invisible"}`} inert={view !== "upnext"}>
          <UpNextPane open={open} />
        </div>
        {relatedMounted && videoId && related && (
          <div className={`scroll-y min-h-0 pr-1 ${view === "related" ? "" : "invisible"}`} inert={view !== "related"}>
            <RelatedPane key={videoId} videoId={videoId} target={related} />
          </div>
        )}
      </div>
    </section>
  );
});

/** The queue as the big tile, opening with the same pop as the lyrics. */
function ExpandedQueue(props: { onToggle: () => void; tab: QueueView; setTab: (v: QueueView) => void }) {
  const ref = usePop<HTMLElement>();
  return <QueueTile open tileRef={ref} {...props} />;
}

/**
 * Bento layout: M3 surface-container tiles. The cover, square and as tall as the view; beside it a column with the
 * track info (big title, artist · album, like/dislike/⋮, playback errors) and the controls (seek bar, the five
 * transport buttons, volume, podcast speed), both only as tall as their content, and Up next | Related taking the
 * rest (opens as the big tile, like the lyrics, with the whole queue, reordering, chips and autoplay). Autoplay and the lyrics preview get a
 * third column on wide windows and sit under Up next on medium ones (Lyrics then opens from the info tile). Bento
 * replaces the bottom player bar, so everything the bar offers is in here; the bottom strip keeps the close button
 * clear of the tiles. Tiles reflow into fewer columns on small windows.
 */
export default function BentoLayout() {
  const track = useCurrentTrack();
  const { videoId, lyrics } = useTrackExtras();
  const { contextTitle, status, error, podcast } = usePlayer(
    useShallow((s) => ({ contextTitle: s.context.title || s.watch?.header?.subtitle, status: s.status, error: s.error, podcast: !!s.queue[s.index]?.podcast })),
  );
  // The big tile (everything but the cover): the full lyrics, or Up next | Related with the whole queue.
  const [big, setBig] = useState<"lyrics" | "queue" | null>(null);
  const expanded = big === "queue" || (big === "lyrics" && !!lyrics);
  const [queueTab, setQueueTab] = useState<QueueView>("upnext");
  // Stable, so the memoized queue tile doesn't re-render with the rest of the layout.
  const toggleQueue = useCallback(() => setBig((b) => (b === "queue" ? null : "queue")), []);

  return (
    <UiStyleScope value="m3" className="np-bento relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="scroll-y min-h-0 flex-1 px-6 pt-6">
        <div className="bento-grid" data-expanded={expanded ? "" : undefined} data-lyrics={lyrics && videoId ? "" : undefined}>
          <Tile area="cover" label="Artwork" className="relative overflow-hidden !p-0">
            <CoverArt className="h-full w-full" halo="inner" />
            <div className="absolute left-4 top-4"><PodcastMode /></div>
          </Tile>
          {/* Middle column: info and controls take only what they need, Up next | Related the rest of the height. */}
          {!expanded && (
            <div className="bento-col">
              {track && (
                <Tile area="info" label="Track" className="flex flex-col gap-2">
                  <p className="type-label-large truncate text-[var(--m3-on-surface-variant)]">{contextTitle ? `Playing from ${contextTitle}` : "Now playing"}</p>
                  {/* Title, artist · album and the actions read as one block. */}
                  <div className="min-w-0">
                    <h1 className="bento-title line-clamp-2" title={track.title}>{track.title}</h1>
                    <TrackLinks track={track} className="type-title-medium mt-1 text-[var(--m3-on-surface-variant)]" />
                    <div className="-ml-2 mt-2 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
                      <TrackActions track={track} />
                      {lyrics && (
                        <button className="bento-lyrics-btn m3-btn m3-tonal h-10" onClick={() => setBig("lyrics")}><MicVocal size={18} aria-hidden /> Lyrics</button>
                      )}
                      <div className="min-w-0 flex-1">
                        {error ? <PlaybackError error={error} /> : status === "loading" && <p className="type-body-medium text-[var(--m3-on-surface-variant)]">Loading…</p>}
                      </div>
                    </div>
                  </div>
                </Tile>
              )}
              <Tile area="controls" label="Playback" className="bento-controls flex flex-col gap-3">
                <SeekBar times="split" />
                <BentoTransport />
                <div className="flex items-center justify-center gap-3">
                  <VolumeControl sliderClassName="w-36" />
                  {podcast && <PodcastSpeed />}
                </div>
              </Tile>
              <QueueTile open={false} onToggle={toggleQueue} tab={queueTab} setTab={setQueueTab} />
            </div>
          )}
          {big === "queue" && <ExpandedQueue onToggle={toggleQueue} tab={queueTab} setTab={setQueueTab} />}
          {big === "lyrics" && expanded && <Expanded onClose={() => setBig(null)} />}
          {/* Autoplay and the lyrics preview: their own column on wide windows, under Up next on medium ones. */}
          {!expanded && (
            <div className="bento-aside">
              <Tile area="context" label="Autoplay and mixes" className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="type-title-medium-em">Autoplay</p>
                    <p className="type-body-medium text-[var(--m3-on-surface-variant)]">Keeps similar music playing when the queue ends.</p>
                  </div>
                  <AutoplayToggle withLabel={false} />
                </div>
                <div className="-mx-2 -mb-3"><QueueChips /></div>
              </Tile>
              {lyrics && videoId && (
                <Tile area="lyrics" label="Lyrics" className="flex min-h-0 flex-col gap-3">
                  <LyricsPreview />
                  <button className="m3-btn m3-tonal h-10 shrink-0 self-start" onClick={() => setBig("lyrics")}><MicVocal size={18} aria-hidden /> Lyrics</button>
                </Tile>
              )}
            </div>
          )}
        </div>
      </div>
      {/* The close button's strip: its own space, so no tile ever sits under it. */}
      <div className="flex h-16 shrink-0 items-center justify-end px-4"><CloseNowPlaying /></div>
    </UiStyleScope>
  );
}
