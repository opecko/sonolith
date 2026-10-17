import { useEffect, useRef } from "react";
import { EmptyState, Loading } from "../components/Status";
import { Spring, ticker } from "../motion";
import { onPlaybackTick, playbackTime, usePlayer } from "../stores/player";
import { PROVIDER_NAMES } from "./providers";
import { lineAt, type LyricLine, type LyricsData } from "./pick";
import { useLyrics } from "./store";

/** After the user scrolls the lyrics, auto-scroll waits this long before following the song again. */
const MANUAL_SCROLL_MS = 4000;

/**
 * Synced lyrics: the current line lights up (words too, when the provider times them), the list scrolls to keep
 * it in view unless the user is scrolling, and a click on a line seeks there. React renders the lines once; the
 * highlight is class flips on the playback clock (every frame with animations on, a few times a second without),
 * the scroll a spring on the scroller (instant with animations off).
 */
function SyncedLines({ lines, size }: { lines: LyricLine[]; size: "full" | "preview" }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const ol = list.current;
    if (!ol) return;
    // The nearest scrolling ancestor (the panel / tile around the lyrics).
    let scroller: HTMLElement | null = ol.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const items = [...ol.children] as HTMLElement[];
    let active = -2;
    let userUntil = 0;
    const spring = scroller ? new Spring(scroller.scrollTop, "slowSpatial", (v) => (scroller!.scrollTop = v), { precision: 0.5 }) : null;
    const follow = (i: number) => {
      if (!scroller || !spring || i < 0 || Date.now() < userUntil) return;
      const li = items[i];
      const target = li.offsetTop - ol.offsetTop - scroller.clientHeight * (size === "preview" ? 0.15 : 0.35) + li.offsetHeight / 2;
      spring.set(scroller.scrollTop);
      spring.to(Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight)));
    };
    const update = () => {
      const ms = playbackTime() * 1000;
      const i = lineAt(lines, ms);
      if (i !== active) {
        items.forEach((li, k) => {
          li.toggleAttribute("data-active", k === i);
          li.toggleAttribute("data-past", k < i);
        });
        active = i;
        follow(i);
      }
      // Word timings: the words sung so far on the current line.
      const words = i >= 0 ? lines[i].words : undefined;
      if (words) items[i].querySelectorAll<HTMLElement>("[data-w]").forEach((w, k) => w.toggleAttribute("data-on", words[k].start <= ms));
    };
    update();
    const manual = () => {
      userUntil = Date.now() + MANUAL_SCROLL_MS;
      spring?.stop();
    };
    scroller?.addEventListener("wheel", manual, { passive: true });
    scroller?.addEventListener("touchstart", manual, { passive: true });
    scroller?.addEventListener("keydown", manual);
    const stopTick = onPlaybackTick(update);
    const stopFrames = ticker(() => usePlayer.getState().status === "playing" && update());
    // A seek moves the clock without playing: show it at once.
    const stopSeek = usePlayer.subscribe(() => update());
    return () => {
      stopTick();
      stopFrames();
      stopSeek();
      spring?.stop();
      scroller?.removeEventListener("wheel", manual);
      scroller?.removeEventListener("touchstart", manual);
      scroller?.removeEventListener("keydown", manual);
    };
  }, [lines, size]);

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
