import { Maximize2, Minimize2, MicVocal, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { getLyrics } from "../../api/ytm";
import type { BrowseRef } from "../../api/types";
import AutoplayToggle from "../../components/AutoplayToggle";
import PlaybackError from "../../components/PlaybackError";
import { PlayIcon, SkipSeconds } from "../../components/PlayerBar";
import PodcastSpeed from "../../components/PodcastSpeed";
import VolumeControl from "../../components/VolumeControl";
import { QueueChips } from "../../components/QueueChips";
import Thumb from "../../components/Thumb";
import { UiStyleScope } from "../../components/UiStyle";
import { useAsync } from "../../hooks/useData";
import { Spring } from "../../motion";
import { usePlayer, type Repeat as RepeatMode } from "../../stores/player";
import { CloseNowPlaying, CoverArt, PodcastMode, SeekBar, TrackActions, TrackLinks, useCurrentTrack } from "./parts";
import { LyricsTab, RelatedTab, UpNextTab, useTrackExtras } from "./shared";

function Tile({ area, className = "", children, label }: { area: string; className?: string; children: ReactNode; label?: string }) {
  return <section aria-label={label} className={`bento-tile np-glass bento-${area} ${className}`}>{children}</section>;
}

/** Opens with a small spring "pop" (scale + opacity written per frame from the shared loop). */
function usePop() {
  const ref = useRef<HTMLDivElement>(null);
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

/**
 * Content swap inside a tile (Up next ↔ Related): the new content slides in from the side it lives on and fades
 * up, on a spring written per frame (instant with animations off). The first render doesn't animate.
 */
function useSwap(key: string, dir: number) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el) return;
    const s = new Spring(0, "defaultSpatial", (p) => {
      el.style.opacity = String(Math.min(1, Math.max(0, p)));
      el.style.transform = `translateX(${Math.round((1 - p) * 24 * dir * 10) / 10}px)`;
    }, { precision: 0.002 });
    s.set(0);
    s.to(1, () => {
      el.style.opacity = "";
      el.style.transform = "";
    });
    return () => s.stop();
  }, [key]);
  return ref;
}

/**
 * Springs an element's height between its natural heights in two states (a rAF spring writing `height`, with
 * `flex: none` so flex sizing doesn't fight it; both cleared at rest). Call `before()` right before the state
 * changes so the old height is known.
 */
function useHeightSpring<T extends HTMLElement>(state: unknown) {
  const ref = useRef<T>(null);
  const from = useRef<number | null>(null);
  const spring = useRef<Spring | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || from.current === null) return;
    const start = from.current;
    from.current = null;
    // The new natural height, then back to where it was for the first frame.
    el.style.height = el.style.flex = "";
    const end = el.offsetHeight;
    el.style.flex = "none";
    el.style.height = `${start}px`;
    spring.current ??= new Spring(start, "defaultSpatial", (h) => (el.style.height = `${Math.max(0, h)}px`), { precision: 0.5 });
    if (!spring.current.animating) spring.current.value = start;
    spring.current.to(end, () => {
      el.style.height = el.style.flex = "";
    });
  }, [state]);
  useLayoutEffect(() => () => spring.current?.stop(), []);
  return { ref, before: () => (from.current = ref.current?.offsetHeight ?? null) };
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
        <li key={`${t.id}:${i}`}>
          <button className="m3-row group flex w-full items-center gap-3 p-1.5 text-left" onClick={() => usePlayer.getState().playIndex(index + 1 + i)}>
            <span className="relative shrink-0">
              <Thumb src={t.thumbnail} px={40} className="h-10 w-10" />
              <span className="m3-art absolute inset-0 hidden items-center justify-center bg-scrim/60 text-on-scrim group-hover:flex"><Play size={16} fill="currentColor" aria-hidden /></span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="type-body-large block truncate">{t.title}</span>
              <span className="type-body-medium block truncate text-[var(--m3-on-surface-variant)]">{t.artists.join(", ") || t.subtitle}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** First lines of the lyrics, fading out; the full text opens in the big tile. */
function LyricsPreview({ videoId, target }: { videoId: string; target: BrowseRef }) {
  const { data } = useAsync(`lyrics:${videoId}`, () => getLyrics(target));
  if (data === undefined) return <p className="type-body-medium text-[var(--m3-on-surface-variant)]">Loading lyrics…</p>;
  if (!data) return <p className="type-body-medium text-[var(--m3-on-surface-variant)]">Lyrics aren't available for this song.</p>;
  return (
    <p className="type-body-large whitespace-pre-line" style={{ maskImage: "linear-gradient(180deg, #000 40%, transparent)" }}>
      {data.text.split("\n").slice(0, 4).join("\n")}
    </p>
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
  const sq = "m3-btn m3-tonal bento-sq h-full min-w-0 flex-1 !px-0";
  return (
    <div className="bento-transport flex items-stretch gap-2" role="group" aria-label="Playback">
      {podcast ? <span className="flex flex-1 items-center justify-center"><SkipSeconds sec={-10} onClick={() => skipBy(-10)} /></span> : (
        <button className={sq} onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={shuffle}><Shuffle size={22} /></button>
      )}
      <button className={sq} onClick={prev} disabled={!hasTrack} aria-label="Previous"><SkipBack size={24} fill="currentColor" /></button>
      <button className="m3-btn m3-filled m3-play bento-play h-full min-w-0 flex-[2] !px-0" onClick={togglePlay} disabled={!hasTrack}
        data-selected={playing ? "" : undefined} aria-label={playing ? "Pause" : "Play"}>
        {status === "loading" ? <PlayIcon status={status} size={28} /> : playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
      </button>
      <button className={sq} onClick={next} disabled={!hasTrack} aria-label="Next"><SkipForward size={24} fill="currentColor" /></button>
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
      {videoId && lyrics && <div className="scroll-y min-h-0 flex-1 pr-1"><LyricsTab key={videoId} videoId={videoId} target={lyrics} /></div>}
    </section>
  );
}

/**
 * Bento layout: M3 surface-container tiles. Left: the cover, track info (title, artist · album, like/dislike/⋮,
 * playback errors) and the controls tile (volume, podcast speed, the five transport buttons, the wavy seek
 * bar). Right column: Up next | Related in one tile (springs open to the full column: the whole queue with
 * reordering, chips and autoplay), Autoplay and Lyrics. Bento replaces the bottom player bar, so everything the
 * bar offers is in here; the bottom strip keeps the close button clear of the tiles. Tiles reflow into fewer
 * columns on small windows.
 */
export default function BentoLayout() {
  const track = useCurrentTrack();
  const { videoId, related, lyrics } = useTrackExtras();
  const { contextTitle, status, error, podcast } = usePlayer(
    useShallow((s) => ({ contextTitle: s.context.title || s.watch?.header?.subtitle, status: s.status, error: s.error, podcast: !!s.queue[s.index]?.podcast })),
  );
  // Full lyrics in the big tile; Up next and Related share the right column's first tile.
  const [big, setBig] = useState(false);
  const expanded = big && !!lyrics;
  const [tab, setView] = useState<"upnext" | "related">("upnext");
  const view = tab === "related" && !related ? "upnext" : tab;
  const swap = useSwap(view, view === "related" ? 1 : -1);
  const [queueOpen, setQueueOpen] = useState(false);
  const queueTile = useHeightSpring<HTMLElement>(queueOpen);
  const queueLeft = usePlayer((s) => Math.max(0, s.queue.length - s.index - 1));
  const toggleQueue = () => {
    queueTile.before();
    setQueueOpen((o) => !o);
  };
  return (
    <UiStyleScope value="m3" className="np-bento relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="scroll-y min-h-0 flex-1 px-6 pt-6">
        <div className="bento-grid" data-expanded={expanded ? "" : undefined}>
          <Tile area="cover" label="Artwork" className="relative overflow-hidden !p-0">
            <CoverArt className="h-full w-full" />
            <div className="absolute left-4 top-4"><PodcastMode /></div>
          </Tile>
          {track && (
            <Tile area="info" label="Track" className="@container flex flex-col justify-between gap-4">
              <p className="type-label-large truncate text-[var(--m3-on-surface-variant)]">{contextTitle ? `Playing from ${contextTitle}` : "Now playing"}</p>
              <div className="min-w-0">
                <h1 className="type-headline-medium-em line-clamp-3 @sm:type-display-small-em" title={track.title}>{track.title}</h1>
                <TrackLinks track={track} className="type-title-medium mt-2 text-[var(--m3-on-surface-variant)] @sm:type-title-large" />
              </div>
              <div className="flex min-h-10 items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {error ? <PlaybackError error={error} /> : status === "loading" && <p className="type-body-medium text-[var(--m3-on-surface-variant)]">Loading…</p>}
                </div>
                <TrackActions track={track} />
              </div>
            </Tile>
          )}
          <Tile area="controls" label="Playback" className="bento-controls flex flex-col justify-between gap-4">
            <div className="flex items-center justify-between gap-3">
              <VolumeControl />
              {podcast && <PodcastSpeed />}
            </div>
            <BentoTransport />
            <SeekBar times="split" />
          </Tile>
          {expanded ? <Expanded onClose={() => setBig(false)} /> : (
            <div className="bento-side">
              <section ref={queueTile.ref} aria-label={view === "related" ? "Related" : "Up next"} className={`bento-tile np-glass bento-queue flex min-h-0 flex-col overflow-hidden ${queueOpen ? "bento-queue-open" : ""}`}>
                <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
                  <div className="m3-segmented flex" role="tablist" aria-label="Up next or related">
                    <button role="tab" className="m3-seg" aria-pressed={view === "upnext"} aria-selected={view === "upnext"} onClick={() => setView("upnext")}>
                      Up next{queueLeft ? <span className="opacity-70">{queueLeft}</span> : null}
                    </button>
                    {related && <button role="tab" className="m3-seg" aria-pressed={view === "related"} aria-selected={view === "related"} onClick={() => setView("related")}>Related</button>}
                  </div>
                  <button className="icon-btn m3-icon-tonal h-10 w-10" onClick={toggleQueue} aria-expanded={queueOpen} aria-label={queueOpen ? "Collapse" : "Show all"} title={queueOpen ? "Collapse" : "Show all"}>
                    {queueOpen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                  </button>
                </header>
                <div ref={swap} role="tabpanel" className="flex min-h-0 flex-1 flex-col">
                  {view === "related" && videoId && related ? (
                    <div className="scroll-y min-h-0 flex-1 pr-1"><RelatedTab key={videoId} videoId={videoId} target={related} /></div>
                  ) : queueOpen ? <div className="flex min-h-0 flex-1 flex-col"><UpNextTab /></div> : <div className="min-h-0 flex-1 overflow-hidden"><QueuePreview /></div>}
                </div>
              </section>
              {!queueOpen && (
                <>
                  <Tile area="context" label="Autoplay and mixes" className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="type-title-medium-em">Autoplay</p>
                        <p className="type-body-medium text-[var(--m3-on-surface-variant)]">Keeps similar music playing when the queue ends.</p>
                      </div>
                      <AutoplayToggle withLabel={false} />
                    </div>
                    <div className="-mx-2 -mb-4"><QueueChips /></div>
                  </Tile>
                  {lyrics && videoId && (
                    <Tile area="lyrics" label="Lyrics" className="flex flex-col gap-3">
                      <LyricsPreview videoId={videoId} target={lyrics} />
                      <button className="m3-btn m3-tonal h-10 self-start" onClick={() => setBig(true)}><MicVocal size={18} aria-hidden /> Lyrics</button>
                    </Tile>
                  )}
                </>
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
