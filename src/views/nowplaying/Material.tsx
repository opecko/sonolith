import { ListMusic, MicVocal, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { UiStyleScope } from "../../components/UiStyle";
import { Spring } from "../../motion";
import PodcastSpeed from "../../components/PodcastSpeed";
import { usePlayer } from "../../stores/player";
import { CloseNowPlaying, CoverArt, PlaybackStatus, PodcastMode, SeekBar, TrackActions, TrackLinks, Transport, useCurrentTrack } from "./parts";
import VolumeRing from "./VolumeRing";
import { LyricsTab, RelatedTab, UpNextTab, useTrackExtras, type Tab } from "./shared";

const TITLES: Record<Tab, string> = { upnext: "Up next", lyrics: "Lyrics", related: "Related" };
/** Critically damped: the pushed content must not swing past where it ends up. */
const PUSH = { damping: 1, stiffness: 380 };

/**
 * Side panel that slides in from the right edge and pushes the content left. Cheap by construction: while it
 * moves, only `transform: translateX` changes on two elements (composited, no layout); when it arrives the final
 * layout (panel in the flex row, content narrower) is committed in one synchronous render inside that frame and
 * the transforms are cleared in the same frame. Closing runs the other way round; switching tabs while open only
 * swaps the panel's content.
 */
/** The side panel's width: even, so the centered content moves by whole pixels (last frame = committed layout). */
const panelWidth = () => 2 * Math.round(Math.min(420, window.innerWidth * 0.34) / 2);

function usePushPanel(open: boolean, width: number) {
  const content = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const spring = useRef<Spring | null>(null);
  const [mounted, setMounted] = useState(open);
  const [dockedState, setDocked] = useState(false);
  // Closing leaves the docked arrangement in the same render, so the first frame of the slide-out is drawn from it.
  const docked = dockedState && open;
  if (open && !mounted) setMounted(true);
  useLayoutEffect(() => {
    if (!mounted) return;
    const c = content.current, p = panel.current;
    if (!c || !p) return;
    if (docked) return;
    // The art + info group is sized from the viewport and the panel width (np-cover / np-info), so it fits beside
    // the docked panel without changing: docking only re-centers it, which moves it left by exactly width / 2.
    const dx = width / 2;
    const paint = (t: number) => {
      // Whole pixels: no subpixel offset for the commit to snap away.
      p.style.transform = `translateX(${Math.round((1 - t) * width)}px)`;
      c.style.transform = t ? `translateX(${-Math.round(t * dx)}px)` : "";
    };
    spring.current ??= new Spring(open ? 0 : 1, PUSH, paint, { precision: 0.001 });
    paint(spring.current.value);
    let inEffect = true;
    spring.current.to(open ? 1 : 0, () => {
      if (open) {
        // Arrived: the real layout now, transforms gone, in this same frame. From the frame loop that takes a
        // synchronous render; when it lands right away (animations off) the effect's own update is just as early.
        if (inEffect) setDocked(true);
        else flushSync(() => setDocked(true));
        c.style.transform = p.style.transform = "";
      } else {
        c.style.transform = "";
        spring.current = null;
        setDocked(false);
        setMounted(false);
      }
    });
    inEffect = false;
  }, [open, mounted]);
  useEffect(() => () => spring.current?.stop(), []);
  return { content, panel, mounted, docked };
}

/**
 * Material layout: big rounded artwork on one side; title, artist and album, seek bar and transport on the other.
 * Queue, Lyrics and Related are tonal toggles top right; each opens the side panel, which pushes the content left.
 */
export default function MaterialLayout() {
  const track = useCurrentTrack();
  const podcast = usePlayer((s) => !!s.queue[s.index]?.podcast);
  const { videoId, related, lyrics } = useTrackExtras();
  const [panel, setPanel] = useState<Tab | null>(null);
  // A panel the next track doesn't have (no lyrics) closes.
  const shown = panel === "lyrics" && !lyrics ? null : panel === "related" && !related ? null : panel;
  const [last, setLast] = useState<Tab>("upnext");
  if (shown && shown !== last) setLast(shown);
  const tab = shown ?? last;
  const [width, setWidth] = useState(panelWidth);
  useEffect(() => {
    const onResize = () => setWidth(panelWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const push = usePushPanel(!!shown, width);
  const toggle = (t: Tab) => setPanel((p) => (p === t ? null : t));
  const tabs: { id: Tab; label: string; icon: typeof ListMusic; show: boolean }[] = [
    { id: "upnext", label: "Queue", icon: ListMusic, show: true },
    { id: "lyrics", label: "Lyrics", icon: MicVocal, show: !!lyrics },
    { id: "related", label: "Related", icon: Sparkles, show: !!related },
  ];
  return (
    <UiStyleScope value="m3" className="np-material relative flex min-h-0 min-w-0 flex-1 overflow-hidden" style={{ "--np-panel": `${width}px` } as CSSProperties}>
      {/* Outside the pushed content and above the panel: the toggles stay put while the panel slides. */}
      <div className="absolute right-6 top-4 z-30 flex items-center gap-2" role="toolbar" aria-label="Now playing panels">
        {tabs.filter((t) => t.show).map(({ id, label, icon: Icon }) => (
          <button key={id} className="icon-btn m3-icon-tonal h-12 w-12" aria-label={label} title={label} aria-pressed={shown === id} onClick={() => toggle(id)}>
            <Icon size={22} />
          </button>
        ))}
      </div>
      <div ref={push.content} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 items-center justify-center gap-12 px-12 pb-2 pt-20 max-lg:flex-col max-lg:gap-6 max-lg:px-8">
          <div className="flex shrink-0 flex-col items-center gap-4">
            <PodcastMode />
            <CoverArt className="np-cover aspect-square rounded-[var(--m3-corner-2xl)]" />
          </div>
          {track && (
            <div className="np-info flex min-w-0 shrink-0 flex-col gap-6">
              {/* Title and links get the full width; the actions sit on their own row below. */}
              <div className="min-w-0">
                <h1 className="type-display-small-em line-clamp-3 max-lg:type-headline-large-em" title={track.title}>{track.title}</h1>
                <TrackLinks track={track} className="type-title-large mt-2 text-[var(--m3-on-surface-variant)]" />
                <div className="-ml-2 mt-2"><TrackActions track={track} /></div>
              </div>
              <SeekBar />
              <Transport split />
            </div>
          )}
        </div>
        {/* What the player bar had (status, podcast speed, volume) and the close button, in a strip of their own. */}
        <div className="flex h-16 shrink-0 items-center gap-3 pl-12 pr-4 max-lg:pl-8">
          <div className="min-w-0 flex-1"><PlaybackStatus /></div>
          {podcast && <PodcastSpeed />}
          <VolumeRing />
          <CloseNowPlaying />
        </div>
      </div>
      {push.mounted && (
        <section ref={push.panel} aria-label={TITLES[tab]} aria-hidden={!shown}
          className={`flex shrink-0 flex-col overflow-hidden rounded-l-[var(--m3-corner-xl)] bg-[var(--m3-surface-container)] ${push.docked ? "relative" : "absolute inset-y-0 right-0 z-20"} ${shown ? "" : "pointer-events-none"}`}
          style={{ width }}>
          {/* The toggles sit over the header's right end (they also close the panel), so it keeps that room. */}
          <header className="flex h-20 shrink-0 items-center gap-2 pl-5" style={{ paddingRight: tabs.filter((t) => t.show).length * 56 + 24 }}>
            <h2 className="type-title-large-em truncate">{TITLES[tab]}</h2>
          </header>
          <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
            {tab === "upnext" && <div className="flex min-h-0 flex-1 flex-col pt-2"><UpNextTab /></div>}
            {tab === "lyrics" && videoId && lyrics && <div className="scroll-y min-h-0 flex-1 pr-1"><LyricsTab key={videoId} videoId={videoId} target={lyrics} /></div>}
            {tab === "related" && videoId && related && <div className="scroll-y min-h-0 flex-1 pr-1"><RelatedTab key={videoId} videoId={videoId} target={related} /></div>}
          </div>
        </section>
      )}
    </UiStyleScope>
  );
}
