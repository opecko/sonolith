import { ListMusic, MicVocal, Sparkles } from "lucide-react";
import { useState } from "react";
import { UiStyleScope } from "../../components/UiStyle";
import { CoverArt, PodcastMode, SeekBar, SlidePanel, TrackActions, TrackLinks, Transport, useCurrentTrack } from "./parts";
import { LyricsTab, RelatedTab, UpNextTab, useTrackExtras, type Tab } from "./shared";

const TITLES: Record<Tab, string> = { upnext: "Up next", lyrics: "Lyrics", related: "Related" };

/**
 * Material layout: big rounded artwork on one side; title, artist and album, seek bar and transport on the other.
 * Queue, Lyrics and Related are tonal toggles top right; each opens a panel that slides in over the artwork, so
 * the controls stay in reach.
 */
export default function MaterialLayout() {
  const track = useCurrentTrack();
  const { videoId, related, lyrics } = useTrackExtras();
  const [panel, setPanel] = useState<Tab | null>(null);
  // A panel the next track doesn't have (no lyrics) closes.
  const shown = panel === "lyrics" && !lyrics ? null : panel === "related" && !related ? null : panel;
  const [last, setLast] = useState<Tab>("upnext");
  if (shown && shown !== last) setLast(shown);
  const toggle = (t: Tab) => setPanel((p) => (p === t ? null : t));
  const tabs: { id: Tab; label: string; icon: typeof ListMusic; show: boolean }[] = [
    { id: "upnext", label: "Queue", icon: ListMusic, show: true },
    { id: "lyrics", label: "Lyrics", icon: MicVocal, show: !!lyrics },
    { id: "related", label: "Related", icon: Sparkles, show: !!related },
  ];
  return (
    <UiStyleScope value="m3" className="np-material relative flex min-h-0 flex-1 flex-col">
      <div className="absolute right-6 top-4 z-30 flex items-center gap-2" role="toolbar" aria-label="Now playing panels">
        {tabs.filter((t) => t.show).map(({ id, label, icon: Icon }) => (
          <button key={id} className="icon-btn m3-icon-tonal h-12 w-12" aria-label={label} title={label} aria-pressed={shown === id} onClick={() => toggle(id)}>
            <Icon size={22} />
          </button>
        ))}
      </div>
      <div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 items-center gap-12 px-12 pb-10 pt-20 max-lg:flex-col max-lg:justify-center max-lg:gap-6 max-lg:px-8">
        {/* The panels slide in over the artwork, clipped to it (on narrow windows they cover the whole view). */}
        <div className="np-art relative flex shrink-0 flex-col items-center gap-4 overflow-hidden rounded-[var(--m3-corner-2xl)]">
          <PodcastMode />
          <CoverArt className="np-cover aspect-square rounded-[var(--m3-corner-2xl)]" />
          <SlidePanel open={!!shown} title={TITLES[shown ?? last]} onClose={() => setPanel(null)}
            className="inset-0 max-lg:fixed max-lg:inset-x-4 max-lg:bottom-4 max-lg:top-20">
            {(shown ?? last) === "upnext" && <div className="flex min-h-0 flex-1 flex-col pt-2"><UpNextTab /></div>}
            {(shown ?? last) === "lyrics" && videoId && lyrics && <div className="scroll-y min-h-0 flex-1 pr-1"><LyricsTab key={videoId} videoId={videoId} target={lyrics} /></div>}
            {(shown ?? last) === "related" && videoId && related && <div className="scroll-y min-h-0 flex-1 pr-1"><RelatedTab key={videoId} videoId={videoId} target={related} /></div>}
          </SlidePanel>
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
    </UiStyleScope>
  );
}
