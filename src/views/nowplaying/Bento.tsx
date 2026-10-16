import { ChevronRight, Minimize2, Play } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { getLyrics } from "../../api/ytm";
import type { BrowseRef } from "../../api/types";
import AutoplayToggle from "../../components/AutoplayToggle";
import { QueueChips } from "../../components/QueuePanel";
import Thumb from "../../components/Thumb";
import { UiStyleScope } from "../../components/UiStyle";
import { useAsync } from "../../hooks/useData";
import { Spring } from "../../motion";
import { usePlayer } from "../../stores/player";
import { CoverArt, PodcastMode, SeekBar, TrackActions, TrackLinks, Transport, useCurrentTrack } from "./parts";
import { LyricsTab, RelatedTab, UpNextTab, useTrackExtras, type Tab } from "./shared";

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

/** The next few tracks; a click plays one. */
function QueuePreview() {
  // The queue array itself (stable until it changes), sliced here: a selector returning a new slice every time
  // would never compare equal.
  const { queue, index } = usePlayer(useShallow((s) => ({ queue: s.queue, index: s.index })));
  const next = useMemo(() => queue.slice(index + 1, index + 6), [queue, index]);
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
    <p className="type-title-medium whitespace-pre-line" style={{ maskImage: "linear-gradient(180deg, #000 55%, transparent)" }}>
      {data.text.split("\n").slice(0, 8).join("\n")}
    </p>
  );
}

const EXPANDED_TITLE: Record<Tab, string> = { upnext: "Up next", lyrics: "Lyrics", related: "Related" };

function Expanded({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const ref = usePop();
  const { videoId, related, lyrics } = useTrackExtras();
  return (
    <section ref={ref} aria-label={EXPANDED_TITLE[tab]} className="bento-tile np-glass bento-main flex min-h-0 flex-col">
      <header className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h2 className="type-title-large-em">{EXPANDED_TITLE[tab]}</h2>
        <button className="m3-btn m3-tonal h-10" onClick={onClose}><Minimize2 size={18} aria-hidden /> Collapse</button>
      </header>
      {tab === "upnext" && <div className="flex min-h-0 flex-1 flex-col"><UpNextTab /></div>}
      {tab === "lyrics" && videoId && lyrics && <div className="scroll-y min-h-0 flex-1 pr-1"><LyricsTab key={videoId} videoId={videoId} target={lyrics} /></div>}
      {tab === "related" && videoId && related && <div className="scroll-y min-h-0 flex-1 pr-1"><RelatedTab key={videoId} videoId={videoId} target={related} /></div>}
    </section>
  );
}

/**
 * Bento layout: surface-container tiles with large corners. A big cover; track info; the controls tile (seek bar,
 * shuffle, previous, play/pause, next, repeat); the queue tile (next few tracks, expandable to the full queue with
 * reordering, chips and autoplay); lyrics, "playing from" and related tiles when the track has them. Tiles reflow
 * into fewer columns on small windows; an expanded tile takes over everything but the cover.
 */
export default function BentoLayout() {
  const track = useCurrentTrack();
  const { videoId, related, lyrics } = useTrackExtras();
  const contextTitle = usePlayer((s) => s.context.title || s.watch?.header?.subtitle);
  const [open, setOpen] = useState<Tab | null>(null);
  const expanded = open === "lyrics" && !lyrics ? null : open === "related" && !related ? null : open;
  const queueLeft = usePlayer((s) => Math.max(0, s.queue.length - s.index - 1));
  return (
    <UiStyleScope value="m3" className="np-bento scroll-y relative min-h-0 flex-1 px-6 pb-6 pt-16">
      <div className="bento-grid" data-expanded={expanded ? "" : undefined}>
        <Tile area="cover" label="Artwork" className="relative overflow-hidden !p-0">
          <CoverArt className="h-full w-full" />
          <div className="absolute left-4 top-4"><PodcastMode /></div>
        </Tile>
        {track && (
          <Tile area="info" label="Track" className="flex flex-col justify-center gap-1">
            {contextTitle && <p className="type-label-large truncate text-[var(--m3-on-surface-variant)]">Playing from {contextTitle}</p>}
            <div className="flex items-start gap-2">
              <h1 className="type-headline-medium-em line-clamp-2 min-w-0 flex-1" title={track.title}>{track.title}</h1>
              <TrackActions track={track} />
            </div>
            <TrackLinks track={track} className="type-title-medium text-[var(--m3-on-surface-variant)]" />
          </Tile>
        )}
        <Tile area="controls" label="Playback" className="bento-controls flex flex-col justify-center gap-5">
          <SeekBar />
          <div className="flex justify-center"><Transport size="md" /></div>
        </Tile>
        {expanded ? <Expanded tab={expanded} onClose={() => setOpen(null)} /> : (
          <>
            <Tile area="queue" label="Up next" className="flex min-h-0 flex-col">
              <header className="mb-2 flex items-center justify-between gap-2">
                <h2 className="type-title-large-em">Up next <span className="type-title-medium text-[var(--m3-on-surface-variant)]">{queueLeft || ""}</span></h2>
                <button className="m3-btn m3-tonal h-10" onClick={() => setOpen("upnext")}>Show all <ChevronRight size={18} aria-hidden /></button>
              </header>
              <div className="min-h-0 flex-1 overflow-hidden"><QueuePreview /></div>
            </Tile>
            {/* Small tiles: their own row of the middle column on wide windows, loose tiles in the grid otherwise. */}
            <div className="bento-extras">
            <Tile area="context" label="Autoplay and mixes" className="flex flex-col justify-between gap-3">
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
              <Tile area="lyrics" label="Lyrics" className="flex min-h-0 flex-col">
                <header className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="type-title-large-em">Lyrics</h2>
                  <button className="icon-btn m3-icon-tonal h-10 w-10" aria-label="Open lyrics" onClick={() => setOpen("lyrics")}><ChevronRight size={20} /></button>
                </header>
                <div className="min-h-0 flex-1 overflow-hidden"><LyricsPreview videoId={videoId} target={lyrics} /></div>
              </Tile>
            )}
            {related && (
              <Tile area="related" label="Related" className="bento-related flex flex-col justify-between gap-3">
                <div>
                  <h2 className="type-title-large-em">Related</h2>
                  <p className="type-body-medium text-[var(--m3-on-surface-variant)]">Songs, albums and artists like this one.</p>
                </div>
                <button className="m3-btn m3-filled h-10 self-start" onClick={() => setOpen("related")}>Explore <ChevronRight size={18} aria-hidden /></button>
              </Tile>
            )}
            </div>
          </>
        )}
      </div>
    </UiStyleScope>
  );
}
