import { ListMusic, MicVocal, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { UiStyleScope } from "../../components/UiStyle";
import { Spring } from "../../motion";
import { CoverArt, PodcastMode, SeekBar, TrackActions, TrackLinks, Transport, useCurrentTrack } from "./parts";
import { LyricsTab, RelatedTab, UpNextTab, useTrackExtras, type Tab } from "./shared";

const TITLES: Record<Tab, string> = { upnext: "Up next", lyrics: "Lyrics", related: "Related" };
/** Critically damped: the pushed content must not swing past where it ends up. */
const PUSH = { damping: 1, stiffness: 380 };
/** The content row's horizontal padding (px-12). */
const PAD = 96;

/**
 * Side panel that slides in from the right edge and pushes the content left. Cheap by construction: while it
 * moves, only `transform: translateX` changes on two elements (composited, no layout); when it arrives the final
 * layout (panel in the flex row, content narrower) is committed in one synchronous render inside that frame and
 * the transforms are cleared in the same frame. Closing runs the other way round; switching tabs while open only
 * swaps the panel's content.
 */
function usePushPanel(open: boolean) {
  const content = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const spring = useRef<Spring | null>(null);
  const [mounted, setMounted] = useState(open);
  const [dockedState, setDocked] = useState(false);
  // Closing leaves the docked arrangement in the same render, so the first frame of the slide-out is drawn from it.
  const docked = dockedState && open;
  const [width, setWidth] = useState(0);
  if (open && !mounted) {
    setMounted(true);
    setWidth(Math.round(Math.min(420, window.innerWidth * 0.34)));
  }
  useLayoutEffect(() => {
    if (!mounted) return;
    const c = content.current, p = panel.current;
    if (!c || !p) return;
    if (docked) return;
    // The art + info group is centered: losing `width` moves it left by half of that, or by half the free space
    // when it has to shrink too (then the text re-wraps once, when the layout is committed).
    const g = group.current;
    const groupWidth = g ? g.lastElementChild!.getBoundingClientRect().right - g.firstElementChild!.getBoundingClientRect().left : 0;
    const dx = Math.min(width, Math.max(0, c.clientWidth - PAD - groupWidth)) / 2;
    const paint = (t: number) => {
      p.style.transform = `translateX(${(1 - t) * width}px)`;
      c.style.transform = t ? `translateX(${-t * dx}px)` : "";
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
  return { content, group, panel, mounted, docked, width };
}

/**
 * Material layout: big rounded artwork on one side; title, artist and album, seek bar and transport on the other.
 * Queue, Lyrics and Related are tonal toggles top right; each opens the side panel, which pushes the content left.
 */
export default function MaterialLayout() {
  const track = useCurrentTrack();
  const { videoId, related, lyrics } = useTrackExtras();
  const [panel, setPanel] = useState<Tab | null>(null);
  // A panel the next track doesn't have (no lyrics) closes.
  const shown = panel === "lyrics" && !lyrics ? null : panel === "related" && !related ? null : panel;
  const [last, setLast] = useState<Tab>("upnext");
  if (shown && shown !== last) setLast(shown);
  const tab = shown ?? last;
  const push = usePushPanel(!!shown);
  const toggle = (t: Tab) => setPanel((p) => (p === t ? null : t));
  const tabs: { id: Tab; label: string; icon: typeof ListMusic; show: boolean }[] = [
    { id: "upnext", label: "Queue", icon: ListMusic, show: true },
    { id: "lyrics", label: "Lyrics", icon: MicVocal, show: !!lyrics },
    { id: "related", label: "Related", icon: Sparkles, show: !!related },
  ];
  return (
    <UiStyleScope value="m3" className="np-material relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* A size container: the cover scales with the space left beside the docked panel (np-cover, cqw). */}
      <div ref={push.content} className="@container relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="absolute right-6 top-4 z-30 flex items-center gap-2" role="toolbar" aria-label="Now playing panels">
          {tabs.filter((t) => t.show).map(({ id, label, icon: Icon }) => (
            <button key={id} className="icon-btn m3-icon-tonal h-12 w-12" aria-label={label} title={label} aria-pressed={shown === id} onClick={() => toggle(id)}>
              <Icon size={22} />
            </button>
          ))}
        </div>
        <div ref={push.group} className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 items-center justify-center gap-12 px-12 pb-10 pt-20 max-lg:flex-col max-lg:gap-6 max-lg:px-8">
          <div className="flex shrink-0 flex-col items-center gap-4">
            <PodcastMode />
            <CoverArt className="np-cover aspect-square rounded-[var(--m3-corner-2xl)]" />
          </div>
          {track && (
            <div className="flex w-full min-w-0 max-w-[640px] flex-1 flex-col gap-6">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h1 className="type-display-small-em line-clamp-2 max-lg:type-headline-large-em" title={track.title}>{track.title}</h1>
                  <TrackLinks track={track} className="type-title-large mt-2 text-[var(--m3-on-surface-variant)]" />
                </div>
                <TrackActions track={track} />
              </div>
              <SeekBar />
              <Transport split />
            </div>
          )}
        </div>
      </div>
      {push.mounted && (
        <section ref={push.panel} aria-label={TITLES[tab]} aria-hidden={!shown}
          className={`flex shrink-0 flex-col overflow-hidden rounded-l-[var(--m3-corner-xl)] bg-[var(--m3-surface-container)] ${push.docked ? "relative" : "absolute inset-y-0 right-0 z-20"} ${shown ? "" : "pointer-events-none"}`}
          style={{ width: push.width }}>
          <header className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-4">
            <h2 className="type-title-large-em">{TITLES[tab]}</h2>
            <button className="icon-btn h-10 w-10" onClick={() => setPanel(null)} aria-label={`Close ${TITLES[tab].toLowerCase()}`}><X size={20} /></button>
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
