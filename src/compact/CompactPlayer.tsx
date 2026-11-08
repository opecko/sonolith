import { Maximize2, Music } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { byline, M3Controls, Progress } from "../components/PlayerBar";
import PlaybackError from "../components/PlaybackError";
import Thumb from "../components/Thumb";
import VolumeControl from "../components/VolumeControl";
import { useSwap } from "../motion";
import { usePlayer } from "../stores/player";
import { columnCoverSize, compactShape, rowCoverSize } from "./layout";
import { growWindow, useWindowSize } from "./windowSize";

// Height the column shape keeps for everything under the cover: title and byline, seek bar, controls, the bottom
// row, gaps and padding.
const COLUMN_RESERVED = 236;

function GrowButton({ label = true }: { label?: boolean }) {
  return label ? (
    <button className="m3-btn m3-text h-10 gap-2 px-3" onClick={growWindow} title="Make the window bigger to see the whole app">
      <Maximize2 size={18} /> Full app
    </button>
  ) : (
    <button className="icon-btn h-10 w-10 shrink-0" onClick={growWindow} aria-label="Make the window bigger" title="Make the window bigger to see the whole app">
      <Maximize2 size={20} />
    </button>
  );
}

function Controls({ size }: { size: "sm" | "md" }) {
  const { status, shuffle, repeat, hasTrack, podcast } = usePlayer(
    useShallow((s) => ({ status: s.status, shuffle: s.shuffle, repeat: s.repeat, hasTrack: s.index >= 0, podcast: !!s.queue[s.index]?.podcast })),
  );
  return <M3Controls status={status} shuffle={shuffle} repeat={repeat} hasTrack={hasTrack} podcast={podcast} size={size} />;
}

/** Title and byline (or the playback error); slides in when the track changes. */
function Info({ center }: { center?: boolean }) {
  const { track, status, error } = usePlayer(useShallow((s) => ({ track: s.queue[s.index], status: s.status, error: s.error })));
  const ref = useSwap(track?.id ?? "", 1);
  const align = center ? "text-center" : "";
  return (
    <div ref={ref} className={`min-w-0 ${align}`}>
      {track ? (
        <>
          <p className="type-title-medium-em truncate" title={track.title}>{track.title}</p>
          {error ? <PlaybackError error={error} /> : (
            <p className="type-body-medium truncate text-[var(--c-text-muted)]" title={byline(track)}>
              {status === "loading" ? "Loading…" : byline(track)}
            </p>
          )}
        </>
      ) : (
        <p className="type-body-medium text-[var(--c-text-subtle)]">Nothing playing</p>
      )}
    </div>
  );
}

function Cover({ px }: { px: number }) {
  const src = usePlayer((s) => s.queue[s.index]?.thumbnail);
  return (
    <div className="shrink-0" style={{ width: px, height: px }}>
      {src ? <Thumb src={src} px={px} className="m3-art-lg h-full w-full" /> : (
        <div className="m3-art-lg flex h-full w-full items-center justify-center bg-[var(--c-surface-2)] text-[var(--c-text-subtle)]">
          <Music size={Math.max(20, Math.round(px / 4))} aria-hidden />
        </div>
      )}
    </div>
  );
}

/**
 * The mini player a small window shows instead of the full layout (compact/layout.ts): cover, title, seek bar and
 * transport, arranged by the window's shape, plus a way back to the full app. Sits over the hidden full layout, under
 * dialogs and toasts.
 */
export default function CompactPlayer() {
  const { width, height } = useWindowSize();
  const shape = compactShape(width, height);
  return (
    <main aria-label="Mini player" className="fixed inset-0 z-[45] flex bg-[var(--c-bg)] text-[var(--c-text)]">
      {shape === "column" && <Column width={width} height={height} />}
      {shape === "row" && <Row width={width} height={height} />}
      {shape === "stack" && <Stack />}
    </main>
  );
}

function Column({ width, height }: { width: number; height: number }) {
  const cover = columnCoverSize(width, height, COLUMN_RESERVED);
  // Shuffle and repeat join the transport once the bigger buttons fit beside it.
  const roomy = width >= 320;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-3">
      <Cover px={cover} />
      <div className="w-full max-w-[360px]"><Info center /></div>
      <div className="flex w-full max-w-[360px] justify-center"><Progress /></div>
      <Controls size={roomy ? "md" : "sm"} />
      <div className="flex w-full max-w-[360px] items-center justify-between">
        {width >= 280 ? <VolumeControl sliderClassName="w-20" /> : <span />}
        <GrowButton label={width >= 280} />
      </div>
    </div>
  );
}

function Row({ width, height }: { width: number; height: number }) {
  const cover = rowCoverSize(width, height);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-4 p-3">
      <Cover px={cover} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1"><Info /></div>
          <GrowButton label={false} />
        </div>
        <Progress />
        <div className="flex items-center justify-between gap-2">
          <Controls size="sm" />
          <div className="max-[560px]:hidden"><VolumeControl sliderClassName="w-20" /></div>
        </div>
      </div>
    </div>
  );
}

function Stack() {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 px-3 py-2">
      <div className="flex items-center gap-3">
        <Cover px={48} />
        <div className="min-w-0 flex-1"><Info /></div>
        <GrowButton label={false} />
      </div>
      <Progress />
      <Controls size="sm" />
    </div>
  );
}
