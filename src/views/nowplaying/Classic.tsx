import { useState } from "react";
import { hiResArt } from "../../api/art";
import TrackVideo from "../../components/TrackVideo";
import { usePlayer } from "../../stores/player";
import { useUi } from "../../stores/ui";
import Visualizer from "../../visualizer/Visualizer";
import { hasVideo, videoModes } from "./parts";
import { LyricsTab, RelatedPanel, UpNextTab, useTrackExtras, type Tab } from "./shared";

function Artwork() {
  const track = usePlayer((s) => s.queue[s.index]);
  const video = useUi((s) => s.showVideo);
  const [failed, setFailed] = useState<string | null>(null);
  const hi = hiResArt(track?.thumbnail, track?.id);
  const src = hi && failed !== hi ? hi : track?.thumbnail;
  const withVideo = !!track && hasVideo(track);
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-8">
      {/* Audio (Song) / Video only for podcast episodes and music videos, like YouTube Music. */}
      {withVideo && (
        <div className="m3-segmented flex rounded-full bg-fg/10 p-1 text-sm" role="group" aria-label="Playback mode">
          {videoModes(!!track?.podcast).map((m) => {
            const on = (m === "Video") === video;
            return (
              <button key={m} aria-pressed={on} onClick={() => useUi.getState().setShowVideo(m === "Video")}
                className={`m3-seg rounded-full px-4 py-1 ${on ? "bg-fg/20 font-medium" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`}>
                {m}
              </button>
            );
          })}
        </div>
      )}
      {withVideo && video && track ? (
        <div className="will-change-transform" style={{ width: "min(100%, calc(1.6 * min(60vh, 45vw)))" }}>
          <TrackVideo key={track.id} videoId={track.id} />
        </div>
      ) : (
        <div className="relative aspect-square rounded-[var(--radius)] bg-[var(--c-surface-2)] shadow-[0_24px_64px_color-mix(in_srgb,var(--c-scrim)_60%,transparent)] will-change-transform"
          style={{ width: "min(60vh, 45vw)" }}>
          <Visualizer at="halo" />
          <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
            {src && <img key={src} src={src} alt="" referrerPolicy="no-referrer" onError={() => hi && setFailed(hi)} className="h-full w-full object-cover" draggable={false} />}
            <Visualizer at="cover" />
          </div>
        </div>
      )}
    </div>
  );
}

function SidePanel() {
  const { videoId, related, hasRelated, lyrics } = useTrackExtras();
  const [tab, setTab] = useState<Tab>("upnext");
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "upnext", label: "Up next", show: true },
    { id: "lyrics", label: "Lyrics", show: !!lyrics },
    { id: "related", label: "Related", show: hasRelated },
  ];
  // A tab that disappears for the next track (e.g. no lyrics) falls back to Up next.
  const active = tabs.find((t) => t.id === tab && t.show) ? tab : "upnext";
  return (
    <section className="flex w-[min(560px,45vw)] shrink-0 flex-col pb-4 pr-6 pt-6">
      <div role="tablist" aria-label="Now playing" className="mb-4 flex border-b border-[var(--c-outline)]">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => setTab(t.id)}
            className={`flex-1 border-b-2 px-4 pb-3 pt-2 text-sm font-medium uppercase tracking-wide ${active === t.id ? "border-fg text-[var(--c-text)]" : "border-transparent text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className={`min-h-0 flex-1 will-change-transform ${active === "upnext" ? "flex flex-col" : "scroll-y pr-1"}`}>
        {active === "upnext" && <UpNextTab />}
        {active === "related" && videoId && <RelatedPanel videoId={videoId} related={related} held={hasRelated} />}
        {active === "lyrics" && videoId && lyrics && <LyricsTab key={videoId} />}
      </div>
    </section>
  );
}

/** The Now Playing from before 2.0: big artwork on the left, Up next / Lyrics / Related tabs on the right. */
export default function ClassicLayout() {
  return (
    <div className="relative flex min-h-0 flex-1">
      <Artwork />
      <SidePanel />
    </div>
  );
}
