import { useLayoutEffect, useRef } from "react";
import { EmptyState, Loading } from "../components/Status";
import { Spring } from "../motion";
import { onPlayhead } from "../playback/playhead";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { createKaraoke, type KaraokeStyle } from "./karaoke";
import { PROVIDER_NAMES } from "./providers";
import type { LyricLine, LyricsData } from "./pick";
import { useLyrics } from "./store";

/** After the user scrolls the lyrics, auto-scroll waits this long before following the song again. */
const MANUAL_SCROLL_MS = 4000;

/**
 * Synced lyrics: the current line lights up (words too, in the chosen karaoke style, when the provider times them),
 * the list scrolls to keep it in view unless the user is scrolling, and a click on a line seeks there. React renders
 * the lines once; the karaoke driver (karaoke.ts) writes the highlight on the playhead (every frame while playing
 * with animations on, a few times a second without), the scroll is a spring on the scroller (instant with
 * animations off).
 */
function SyncedLines({ lines, size }: { lines: LyricLine[]; size: "full" | "preview" }) {
  const list = useRef<HTMLOListElement>(null);
  const chosen = useSettings((s) => s.karaokeStyle);
  const animations = useSettings((s) => s.appearance.animations);
  const style: KaraokeStyle = animations ? chosen : "simple";
  // Before paint: an upgrade (line-synced → word-synced) swaps the lines with the current one already lit.
  useLayoutEffect(() => {
    const ol = list.current;
    if (!ol) return;
    // The nearest scrolling ancestor (the panel / tile around the lyrics).
    let scroller: HTMLElement | null = ol.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    let userUntil = 0;
    const spring = scroller ? new Spring(scroller.scrollTop, "slowSpatial", (v) => (scroller!.scrollTop = v), { precision: 0.5 }) : null;
    // New lines in a scroller already showing lyrics (an upgrade): land on the current line without a glide.
    let instant = scroller ? scroller.scrollTop > 0 : false;
    const follow = (i: number) => {
      const li = ol.querySelector<HTMLElement>(`:scope > li[data-i="${i}"]`);
      if (!scroller || !spring || !li || Date.now() < userUntil) return;
      const target = li.offsetTop - ol.offsetTop - scroller.clientHeight * (size === "preview" ? 0.15 : 0.35) + li.offsetHeight / 2;
      const to = Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight));
      if (instant) {
        instant = false;
        spring.set(to);
        scroller.scrollTop = to;
        return;
      }
      spring.set(scroller.scrollTop);
      spring.to(to);
    };
    // One loop with the seek bars (playback/playhead.ts): every frame while playing, else on seeks and pauses.
    const karaoke = createKaraoke(ol, lines, style, follow);
    const stop = onPlayhead((sec) => karaoke.update(sec * 1000));
    const manual = () => {
      userUntil = Date.now() + MANUAL_SCROLL_MS;
      spring?.stop();
    };
    scroller?.addEventListener("wheel", manual, { passive: true });
    scroller?.addEventListener("touchstart", manual, { passive: true });
    scroller?.addEventListener("keydown", manual);
    return () => {
      stop();
      karaoke.dispose();
      spring?.stop();
      scroller?.removeEventListener("wheel", manual);
      scroller?.removeEventListener("touchstart", manual);
      scroller?.removeEventListener("keydown", manual);
    };
  }, [lines, size, style]);

  return (
    <ol ref={list} className={`lyrics-synced ${size === "preview" ? "lyrics-preview" : ""}`}
      onClick={(e) => {
        const li = (e.target as Element).closest<HTMLElement>("li[data-i]");
        if (li) usePlayer.getState().seek(lines[Number(li.dataset.i)].start / 1000);
      }}>
      {lines.map((l, i) => (
        <li key={i} data-i={i} title="Play from here">
          {l.words?.length ? l.words.map((w, k) => <span key={k} data-w="">{w.text}</span>) : l.text}
        </li>
      ))}
    </ol>
  );
}

/** "Lyrics from LRCLIB" (+ the provider's own source, e.g. "· Musixmatch"). */
export function LyricsCredit({ data }: { data: LyricsData }) {
  const source = data.source && data.source !== PROVIDER_NAMES[data.provider] ? ` · ${data.source}` : "";
  return <p className="mt-6 text-xs text-[var(--c-text-subtle)]">Lyrics from {PROVIDER_NAMES[data.provider]}{source}</p>;
}

/** The lyrics of the playing track, synced when a provider has them (Now Playing's lyrics tab / tile). */
export default function LyricsView({ size = "full" }: { size?: "full" | "preview" }) {
  const { status, data } = useLyrics();
  if (status !== "done") return <Loading variant="list" label="Loading lyrics" />;
  if (!data) return <EmptyState title="Lyrics aren't available" />;
  return (
    <div className={size === "preview" ? "" : "px-2"}>
      {data.synced ? <SyncedLines lines={data.lines} size={size} /> : (
        <p className={`select-text whitespace-pre-wrap ${size === "preview" ? "type-body-large" : "text-lg leading-8"}`}>{data.plain}</p>
      )}
      {size === "full" && <LyricsCredit data={data} />}
    </div>
  );
}
