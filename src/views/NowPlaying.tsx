import { ChevronDown } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { hiResArt } from "../api/art";
import type { BrowseRef } from "../api/types";
import { getLyrics, getRelated } from "../api/ytm";
import AutoplayToggle from "../components/AutoplayToggle";
import PodcastVideo from "../components/PodcastVideo";
import { QueueChips } from "../components/QueuePanel";
import QueueList from "../components/QueueList";
import { Shelves } from "../components/Shelves";
import { EmptyState, ErrorBox, Loading } from "../components/Status";
import { useAsync } from "../hooks/useData";
import { useNav } from "../stores/nav";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useUi } from "../stores/ui";

type Tab = "upnext" | "related" | "lyrics";

/**
 * Ambient light: the art is drawn once into a 12×12 canvas and stretched by the browser, which gives a soft blur
 * with no CSS filter. A static layer costs nothing to recomposite while the user hovers or scrolls above it.
 */
const AmbientLayer = memo(function AmbientLayer({ src, opacity }: { src: string; opacity: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      const ctx = ref.current?.getContext("2d");
      if (!ctx) return;
      // Two-step downscale averages more pixels than a single 1200→12 sample.
      const mid = document.createElement("canvas");
      mid.width = mid.height = 48;
      mid.getContext("2d")?.drawImage(img, 0, 0, 48, 48);
      ctx.drawImage(mid, 0, 0, 12, 12);
    };
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return <canvas ref={ref} width={12} height={12} className="fade-in absolute inset-0 h-full w-full" style={{ opacity }} />;
});

const Backdrop = memo(function Backdrop({ src, intensity }: { src?: string; intensity: number }) {
  const [layers, setLayers] = useState<string[]>(src ? [src] : []);
  useEffect(() => {
    if (src) setLayers((l) => (l.at(-1) === src ? l : [...l.slice(-1), src]));
  }, [src]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden will-change-transform" aria-hidden>
      {layers.map((l) => <AmbientLayer key={l} src={l} opacity={intensity} />)}
      <div className="absolute inset-0 bg-[var(--c-overlay)]" />
    </div>
  );
});

function Artwork() {
  const track = usePlayer((s) => s.queue[s.index]);
  const video = useUi((s) => s.podcastVideo);
  const [failed, setFailed] = useState<string | null>(null);
  const hi = hiResArt(track?.thumbnail, track?.id);
  const src = hi && failed !== hi ? hi : track?.thumbnail;
  const podcast = !!track?.podcast;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-8">
      {/* Audio / Video only exists for podcast episodes, like YouTube Music. */}
      {podcast && (
        <div className="flex rounded-full bg-fg/10 p-1 text-sm" role="group" aria-label="Playback mode">
          {(["Audio", "Video"] as const).map((m) => {
            const on = (m === "Video") === video;
            return (
              <button key={m} aria-pressed={on} onClick={() => useUi.getState().setPodcastVideo(m === "Video")}
                className={`rounded-full px-4 py-1 ${on ? "bg-fg/20 font-medium" : "text-[var(--c-text-muted)] hover:text-[var(--c-text)]"}`}>
                {m}
              </button>
            );
          })}
        </div>
      )}
      {podcast && video && track ? (
        <div className="will-change-transform" style={{ width: "min(100%, calc(1.6 * min(60vh, 45vw)))" }}>
          <PodcastVideo key={track.id} videoId={track.id} />
        </div>
      ) : (
        <div className="aspect-square overflow-hidden rounded-[var(--radius)] bg-[var(--c-surface-2)] shadow-[0_24px_64px_color-mix(in_srgb,var(--c-scrim)_60%,transparent)] will-change-transform"
          style={{ width: "min(60vh, 45vw)" }}>
          {src && <img key={src} src={src} alt="" referrerPolicy="no-referrer" onError={() => hi && setFailed(hi)} className="h-full w-full object-cover" draggable={false} />}
        </div>
      )}
    </div>
  );
}

function UpNextTab() {
  const header = usePlayer((s) => s.watch?.header);
  const contextTitle = usePlayer((s) => s.context.title);
  const caption = "Playing from";
  // The queue's own name (playlist, album, mix, radio) wins; /next's per-track header is only a fallback.
  const title = contextTitle || header?.subtitle;
  return (
    <>
      <div className="mb-4 flex shrink-0 items-start justify-between gap-4 px-2">
        <div className="min-w-0">
          <p className="text-xs text-[var(--c-text-muted)]">{caption}</p>
          {title && <p className="truncate text-base font-semibold">{title}</p>}
        </div>
        <AutoplayToggle />
      </div>
      <div className="shrink-0"><QueueChips /></div>
      <div className="scroll-y min-h-0 flex-1 pr-1">
        <QueueList autoScroll />
      </div>
    </>
  );
}

function RelatedTab({ videoId, target }: { videoId: string; target: BrowseRef }) {
  const { data, error, reload } = useAsync(`related:${videoId}`, () => getRelated(target));
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Loading variant="list" label="Loading related" />;
  if (!data.length) return <EmptyState title="Nothing related" />;
  return <Shelves shelves={data} />;
}

function LyricsTab({ videoId, target }: { videoId: string; target: BrowseRef }) {
  const { data, error, reload } = useAsync(`lyrics:${videoId}`, () => getLyrics(target));
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (data === undefined) return <Loading variant="list" label="Loading lyrics" />;
  if (!data) return <EmptyState title="Lyrics aren't available" />;
  return (
    <div className="px-2">
      <p className="select-text whitespace-pre-wrap text-lg leading-8">{data.text}</p>
      {data.source && <p className="mt-6 text-xs text-[var(--c-text-subtle)]">{data.source}</p>}
    </div>
  );
}

function SidePanel() {
  const videoId = usePlayer((s) => s.queue[s.index]?.id);
  const related = usePlayer((s) => (s.watch?.videoId === videoId ? s.watch?.related : undefined));
  const lyrics = usePlayer((s) => (s.watch?.videoId === videoId ? s.watch?.lyrics : undefined));
  const [tab, setTab] = useState<Tab>("upnext");
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "upnext", label: "Up next", show: true },
    { id: "lyrics", label: "Lyrics", show: !!lyrics },
    { id: "related", label: "Related", show: !!related },
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
        {active === "related" && videoId && related && <RelatedTab key={videoId} videoId={videoId} target={related} />}
        {active === "lyrics" && videoId && lyrics && <LyricsTab key={videoId} videoId={videoId} target={lyrics} />}
      </div>
    </section>
  );
}

/** Full-window overlay above the content but below the player bar; playback state is untouched. */
export default function NowPlaying() {
  const open = useUi((s) => s.nowPlaying);
  const close = () => useUi.getState().setNowPlaying(false);
  const thumb = usePlayer((s) => s.queue[s.index]?.thumbnail);
  // Ambient light (Settings → Appearance); when off it is neither computed nor drawn, the overlay shows --c-bg.
  const ambientOn = useSettings((s) => s.appearance.ambient);
  const ambientIntensity = useSettings((s) => s.appearance.ambientIntensity);
  const route = useNav((s) => s.route);
  // Stays mounted after closing until the slide-down animation ends (set during render, so no frame is lost).
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="menu"]') && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // Navigating from inside (Related cards, menus) shows the target page.
  useEffect(() => {
    close();
  }, [route]);

  if (!mounted) return null;
  return (
    <div role="dialog" aria-label="Now playing" aria-hidden={!open}
      className={`${open ? "slide-up" : "slide-down pointer-events-none"} fixed inset-x-0 bottom-[72px] top-0 z-30 flex bg-[var(--c-bg)]`}
      onAnimationEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        if (open) useUi.getState().setNowPlayingCovering(true);
        else setMounted(false);
      }}>
      {ambientOn && <Backdrop src={thumb} intensity={ambientIntensity} />}
      <button onClick={close} aria-label="Close now playing" className="icon-btn absolute left-4 top-4 z-10 h-10 w-10">
        <ChevronDown size={24} />
      </button>
      <div className="relative flex min-h-0 flex-1">
        <Artwork />
        <SidePanel />
      </div>
    </div>
  );
}
