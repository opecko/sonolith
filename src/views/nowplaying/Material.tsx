import { ListMusic, MicVocal, Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { UiStyleScope } from "../../components/UiStyle";
import PodcastSpeed from "../../components/PodcastSpeed";
import VolumeControl from "../../components/VolumeControl";
import { usePlayer } from "../../stores/player";
import { CloseNowPlaying, CoverArt, PlaybackStatus, VideoMode, SeekBar, TrackActions, TrackLinks, Transport, useCurrentTrack } from "./parts";
import { PushPanel, type PanelView } from "./pushPanel";
import { LyricsTab, RelatedPanel, UpNextTab, useTrackExtras, type Tab } from "./shared";

const TITLES: Record<Tab, string> = { upnext: "Up next", lyrics: "Lyrics", related: "Related" };

/** The side panel's width: even, so the centered content moves by whole pixels when it is fully open. */
const panelWidth = () => 2 * Math.round(Math.min(420, window.innerWidth * 0.34) / 2);

/**
 * Side panel sliding in from the right edge, pushing the content left. The panel's own width in the flex row
 * springs (PushPanel), its content stays at full width inside, anchored left, so it slides in; everything beside it
 * (cover, info, the bottom strip with volume and close) is laid out normally on every frame. The last frame is
 * therefore the final layout itself: nothing to commit, nothing to snap.
 */
function usePushPanel(target: Tab | null, width: number) {
  const panel = useRef<HTMLElement | null>(null);
  const ctl = useRef<PushPanel | null>(null);
  const [view, setView] = useState<PanelView>({ mounted: target !== null, tab: target ?? "upnext" });
  ctl.current ??= new PushPanel(width, (px) => panel.current && (panel.current.style.width = `${px}px`), setView, target);
  useLayoutEffect(() => ctl.current!.setTarget(target), [target]);
  useLayoutEffect(() => ctl.current!.setWidth(width), [width]);
  useEffect(() => () => ctl.current?.dispose(), []);
  // The element mounts at the spring's current width (0 when it starts opening).
  const ref = useCallback((el: HTMLElement | null) => {
    panel.current = el;
    if (el) el.style.width = `${ctl.current!.px}px`;
  }, []);
  return { ref, ...view };
}

/**
 * Material layout: big rounded artwork on one side; title, artist and album, seek bar and transport on the other.
 * Queue, Lyrics and Related are tonal toggles top right; each opens the side panel, which pushes the content left.
 */
export default function MaterialLayout() {
  const track = useCurrentTrack();
  const podcast = usePlayer((s) => !!s.queue[s.index]?.podcast);
  const { videoId, related, hasRelated, lyrics } = useTrackExtras();
  const [panel, setPanel] = useState<Tab | null>(null);
  // A panel the new track doesn't have (no lyrics, no related) slides closed, the reverse of opening, and stays
  // closed: the content stays while it slides (the panel keeps its tab), saying there's nothing.
  useEffect(() => {
    if (!lyrics) setPanel((p) => (p === "lyrics" ? null : p));
  }, [lyrics]);
  useEffect(() => {
    if (!hasRelated) setPanel((p) => (p === "related" ? null : p));
  }, [hasRelated]);
  const shown = panel;
  const [width, setWidth] = useState(panelWidth);
  useEffect(() => {
    const onResize = () => setWidth(panelWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const push = usePushPanel(shown, width);
  const tab = push.tab;
  const toggle = (t: Tab) => setPanel((p) => (p === t ? null : t));
  const tabs: { id: Tab; label: string; icon: typeof ListMusic; show: boolean }[] = [
    { id: "upnext", label: "Queue", icon: ListMusic, show: true },
    { id: "lyrics", label: "Lyrics", icon: MicVocal, show: !!lyrics },
    { id: "related", label: "Related", icon: Sparkles, show: hasRelated },
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
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 items-center justify-center gap-12 px-12 pb-2 pt-20 max-lg:flex-col max-lg:gap-6 max-lg:px-8">
          <div className="flex shrink-0 flex-col items-center gap-4 max-lg:min-h-0 max-lg:w-full max-lg:shrink">
            <VideoMode />
            <div className="np-cover-box flex justify-center">
              <CoverArt className="np-cover aspect-square rounded-[var(--m3-corner-2xl)]" />
            </div>
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
          <VolumeControl />
          <CloseNowPlaying />
        </div>
      </div>
      {push.mounted && (
        // Width written per frame by the spring; the content inside keeps the full width (anchored left).
        <section ref={push.ref} aria-label={TITLES[tab]} aria-hidden={!shown} className={`relative shrink-0 overflow-hidden ${shown ? "" : "pointer-events-none"}`}>
          <div className="absolute inset-y-0 left-0 flex flex-col overflow-hidden rounded-l-[var(--m3-corner-xl)] bg-[var(--m3-surface-container)]" style={{ width }}>
            {/* The toggles sit over the header's right end (they also close the panel), so it keeps that room. */}
            <header className="flex h-20 shrink-0 items-center gap-2 pl-5" style={{ paddingRight: tabs.filter((t) => t.show).length * 56 + 24 }}>
              <h2 className="type-title-large-em truncate">{TITLES[tab]}</h2>
            </header>
            <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
              {tab === "upnext" && <div className="flex min-h-0 flex-1 flex-col pt-2"><UpNextTab /></div>}
              {tab === "lyrics" && videoId && <div className="scroll-y min-h-0 flex-1 pr-1"><LyricsTab key={videoId} /></div>}
              {tab === "related" && videoId && <div className="scroll-y min-h-0 flex-1 pr-1"><RelatedPanel videoId={videoId} related={related} held={hasRelated} /></div>}
            </div>
          </div>
        </section>
      )}
    </UiStyleScope>
  );
}
