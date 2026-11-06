// The recap story player: a full-window overlay with one portrait card (designed at 360 × 640 units, scaled as a
// whole), segmented progress, click halves or ←/→ to move, Space to pause auto-advance, Esc to close. The recap's
// palette (from its top covers) sits behind the card. One card is mounted at a time; the next one's images load
// ahead.
import { ChevronsRight, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { hiResArt } from "../../api/art";
import { motionOn, ticker, tween } from "../../motion";
import { readSource } from "../../stores/coverColors";
import { usePlayer } from "../../stores/player";
import { useSettings } from "../../stores/settings";
import { RECAP_MOODS, recapConfetti, recapPalette, recapVars, type RecapMood, type RecapPalette } from "../../theme/recapPalette";
import { buildDeck, type Slide } from "../deck";
import { periodTitle } from "../periods";
import type { PlayTarget } from "../slides";
import { closeRecapPlayer, newSeed, saveResume, useRecapUi, type PlayerOpen } from "../ui";
import { auraTrail } from "../aura";
import Aura from "./Aura";
import Confetti from "./Confetti";
import { EndActions, FinalePoster } from "./Finale";
import GameCard from "./GameCard";
import { autoAdvancing, clickAction, keyAction, step, type NavAction } from "./nav";
import { easeInOut, EntranceHold } from "./anim";
import { pickTransition, transitionFrame, TRANSITION_MS, type Frame, type TransitionKind } from "./transitions";
import { useRecapMusic } from "./useRecapMusic";
import { musicTracks, songFor } from "../music";
import { STYLE_COMPONENTS } from "./styles";

export default function RecapPlayer() {
  const open = useRecapUi((s) => s.open);
  if (!open) return null;
  return <Player key={`${open.snapshot.id}:${open.seed}`} {...open} />;
}

const CARD_W = 360, CARD_H = 640;

function imagesOf(s: Slide | undefined): string[] {
  if (!s) return [];
  const d = s.useAlt && s.alt ? s.alt : s.data;
  if (d.shape === "hero") return d.item.image ? [hiResArt(d.item.image)!] : [];
  if (d.shape === "covers") return d.images;
  if (d.shape === "rank") return d.items.map((i) => i.image).filter((x): x is string => !!x);
  return [];
}

function playTarget(t: PlayTarget) {
  const p = usePlayer.getState();
  if (t.kind === "track") p.playQueue([{ type: "track", id: t.videoId, title: t.title, subtitle: t.artist, artists: [t.artist], thumbnail: t.thumbnail }], 0);
  else void p.startRadio({ type: "artist", id: t.id }, t.name);
}

const noEntering = () => {};
const noHold = () => {};

function Player({ snapshot, seed, start, forceGames, forceStyle, deck: given }: PlayerOpen) {
  const autoAdvance = useSettings((s) => s.recap.autoAdvance);
  const music = useSettings((s) => s.recap.music);
  const deck = useMemo(() => given ?? buildDeck(snapshot, { seed, games: "sometimes", forceGames, forceStyle }), [snapshot, seed]);
  const n = deck.slides.length;
  const [index, setIndex] = useState(Math.min(start, n - 1));
  const [paused, setPaused] = useState(false);
  // A card that waits for the user (scratch card) holds auto-advance; the hold belongs to that card's index, so it
  // ends with the card without a reset effect (which would run after the new card's own hold and undo it).
  const [hold, setHold] = useState<{ index: number; on: boolean }>({ index: -1, on: false });
  const heldByCard = hold.index === index && hold.on;
  const holders = useRef(new Map<number, (on: boolean) => void>());
  const holdFor = (i: number) => {
    let h = holders.current.get(i);
    if (!h) holders.current.set(i, (h = (on: boolean) => setHold((cur) => (on ? { index: i, on } : cur.index === i ? { index: i, on: false } : cur))));
    return h;
  };
  // Entrances still playing on this card: the reading time starts once they're done.
  const [entering, setEntering] = useState(0);
  const onEntering = useCallback((d: number) => setEntering((n) => Math.max(0, n + d)), []);
  const held = heldByCard || entering > 0;
  const slide = deck.slides[index];
  // Your top songs under the story, one per third; the toggle in the top bar is the "music" setting.
  const songIds = useMemo(() => musicTracks(snapshot.stats.topTracks).map((t) => t.videoId), [snapshot]);
  useRecapMusic(songIds, songFor(index, n, songIds.length), music && songIds.length > 0);
  const toggleMusic = () => useSettings.getState().set({ recap: { ...useSettings.getState().recap, music: !music } });
  const last = index === n - 1;

  // Palette from the top covers' colors; a neutral one until they're read.
  const [sources, setSources] = useState<number[]>([]);
  useEffect(() => {
    const covers = [snapshot.stats.topTracks[0]?.thumbnail, snapshot.stats.topArtists[0]?.thumbnail, snapshot.stats.topTracks[1]?.thumbnail].filter((x): x is string => !!x);
    let live = true;
    void Promise.all(covers.map((c) => readSource(c))).then((cs) => live && setSources(cs.filter((c): c is number => c !== null)));
    return () => {
      live = false;
    };
  }, [snapshot.id]);
  const palettes = useMemo(() => Object.fromEntries(RECAP_MOODS.map((m) => [m, recapPalette(sources, m)])) as Record<RecapMood, RecapPalette>, [sources]);
  const pal = palettes[slide.mood];
  // The aura starts as the song last played in the app (else the recap's top song) and changes at big moments.
  const trail = useMemo(() => {
    const p = usePlayer.getState();
    return auraTrail(deck.slides, p.queue[p.index]?.thumbnail ?? snapshot.stats.topTracks[0]?.thumbnail);
  }, [deck]);

  // Card scale: the whole 360 × 640 design fits the space left by the top bar (and the end actions).
  const area = useRef<HTMLDivElement>(null);
  const [u, setU] = useState(1);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const fit = () => setU(Math.max(0.3, Math.min(el.clientWidth / CARD_W, el.clientHeight / CARD_H)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [last]);

  // Card transitions: the card being left stays mounted (same key, so it doesn't restart) while the next comes in.
  // The first frame is part of the render (no flash of the finished card); the engine moves the rest.
  const [move, setMove] = useState<{ from: number; to: number; kind: TransitionKind; dir: 1 | -1 } | null>(null);
  const layerEls = useRef(new Map<number, HTMLElement>());
  // Derived from the index change during render (React's pattern for it, StrictMode-safe with state, not a ref).
  const [shown, setShown] = useState(index);
  const stopTransition = useRef<() => void>(() => {});
  if (shown !== index) {
    setShown(index);
    setMove(motionOn() ? { from: shown, to: index, kind: pickTransition(deck.seed, index, deck.slides[index].kind), dir: index > shown ? 1 : -1 } : null);
  }
  const layers = move ? [move.from, move.to] : [index];
  useLayoutEffect(() => {
    if (!move) return;
    const apply = (el: HTMLElement | undefined, f: Frame) => {
      if (!el) return;
      el.style.transform = f.transform ?? "";
      el.style.clipPath = f.clipPath ?? "";
      el.style.opacity = f.opacity ?? "";
    };
    stopTransition.current = tween(TRANSITION_MS, easeInOut, (p) => {
      const f = transitionFrame(move.kind, p, move.dir);
      apply(layerEls.current.get(move.to), f.in);
      apply(layerEls.current.get(move.from), f.out);
    }, () => setMove((cur) => (cur === move ? null : cur)));
    return () => stopTransition.current();
  }, [move]);

  const go = useCallback((to: number) => setIndex(Math.max(0, Math.min(n - 1, to))), [n]);
  const act = (a: NavAction | null) => {
    if (a === "close") closeRecapPlayer();
    else if (a === "pause") setPaused((p) => !p);
    else if (a) setIndex((i) => step(i, n, a));
  };
  const next = () => act("next");

  useEffect(() => saveResume(snapshot.id, seed, last ? 0 : index), [index]);
  // Performance marks per card (DevTools → Performance): from the card change to its first painted frame.
  useLayoutEffect(() => {
    performance.mark(`recap:card:${index}`);
    const raf = requestAnimationFrame(() => {
      try {
        performance.measure(`recap:card:${index}:${slide.style ?? (slide.game ? "game" : slide.kind)}`, `recap:card:${index}`);
      } catch {
        /* mark cleared */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [index]);

  // Preload the next card's images.
  useEffect(() => {
    for (const src of imagesOf(deck.slides[index + 1]).slice(0, 16)) {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.src = src;
    }
  }, [index]);

  // Auto-advance: a timer for the card's time, paused by Space, the hidden window, games and holding cards.
  const bar = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const running = autoAdvancing({ autoAdvance, paused, held, hidden, game: !!slide.game, last, duration: slide.duration });
  const elapsed = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
  }, [index]);
  useEffect(() => {
    const fill = (f: number) => bar.current && (bar.current.style.width = `${Math.min(100, f * 100)}%`);
    if (!running) {
      fill(autoAdvance && !slide.game ? elapsed.current / slide.duration : 1);
      return;
    }
    const began = performance.now() - elapsed.current;
    const t = setTimeout(() => go(index + 1), slide.duration - elapsed.current);
    const stopTick = motionOn() ? ticker(() => fill((performance.now() - began) / slide.duration)) : (fill(1), () => {});
    return () => {
      clearTimeout(t);
      stopTick();
      elapsed.current = Math.min(slide.duration, performance.now() - began);
    };
  }, [running, index]);

  // Keys: Esc, ←/→, Space; the app's own shortcuts are off while the recap is open (shortcuts/init.ts).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inControl = !!(e.target as HTMLElement)?.closest?.("button, input, select, textarea");
      const a = keyAction(e.key, { game: !!slide.game, inControl });
      if (!a) return;
      act(a);
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const onCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, a, input, canvas")) return;
    const r = e.currentTarget.getBoundingClientRect();
    act(clickAction((e.clientX - r.left) / r.width, !!slide.game));
  };

  const vars = recapVars(pal) as CSSProperties;
  const big = slide.kind === "topArtist" || slide.kind === "finale" || (slide.kind === "topTrack" && snapshot.period.kind === "year");
  const title = `Sonolith Recap: ${periodTitle(snapshot.period)}`;

  return (
    <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} data-recap
      className="fixed inset-0 z-[90] flex flex-col select-none outline-none"
      style={{ ...vars, background: "var(--rc-stage)", color: "var(--rc-fg)", transition: "background-color 400ms" }}>
      <Aura src={trail[index]} />
      <div className="relative z-[3] flex shrink-0 flex-col gap-2 px-3 pt-3">
        <div className="flex gap-1" aria-hidden>
          {deck.slides.map((s, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--rc-fg) 25%, transparent)" }}>
              {i < index && <div className="h-full w-full" style={{ background: "var(--rc-fg)" }} />}
              {i === index && <div ref={bar} className="h-full" style={{ width: s.game ? "100%" : 0, background: "var(--rc-fg)" }} />}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}{!snapshot.frozen && " · preview"}</p>
          {songIds.length > 0 && (
            <button type="button" className="icon-btn" aria-label="Music" aria-pressed={music} title={music ? "Turn the music off" : "Play your top songs"} onClick={toggleMusic} style={{ color: "var(--rc-fg)" }}>
              {music ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
          )}
          {autoAdvance && !last && (
            <button type="button" className="icon-btn" aria-label={paused ? "Resume" : "Pause"} aria-pressed={paused} onClick={() => setPaused(!paused)} style={{ color: "var(--rc-fg)" }}>
              {paused ? <Play size={20} /> : <Pause size={20} />}
            </button>
          )}
          {!last && (
            <button type="button" className="icon-btn" aria-label="Skip to the end" title="Skip to the end" onClick={() => act("end")} style={{ color: "var(--rc-fg)" }}>
              <ChevronsRight size={20} />
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Close recap" title="Close (Esc)" onClick={closeRecapPlayer} style={{ color: "var(--rc-fg)" }}>
            <X size={20} />
          </button>
        </div>
      </div>
      <div ref={area} className="relative z-[3] flex min-h-0 flex-1 items-center justify-center p-3">
        <div onClick={onCardClick} role="group" aria-roledescription="card" aria-label={`Card ${index + 1} of ${n}`}
          className="relative overflow-hidden"
          style={{ width: CARD_W * u, height: CARD_H * u, ["--u" as string]: `${u}px`, borderRadius: 24 * u, background: "var(--rc-stage)", cursor: slide.game ? "default" : "pointer" } as CSSProperties}>
          <p className="sr-only" aria-live="polite">{slide.aria}</p>
          {layers.map((i) => {
            const s = deck.slides[i];
            const active = i === index;
            const C = s.style ? STYLE_COMPONENTS[s.style] : null;
            const d = s.useAlt && s.alt ? s.alt : s.data;
            // Each card keeps its own palette while it leaves.
            return (
              <div key={i} ref={(el) => void (el ? layerEls.current.set(i, el) : layerEls.current.delete(i))} aria-hidden={!active}
                className="absolute inset-0 overflow-hidden"
                style={{ ...(recapVars(palettes[s.mood]) as CSSProperties), ...(move?.to === i ? transitionFrame(move.kind, 0, move.dir).in : {}), zIndex: active ? 2 : 1, pointerEvents: active ? undefined : "none" }}>
                <EntranceHold.Provider value={active ? onEntering : noEntering}>
                  {s.game ? (
                    <GameCard game={s.game} seed={deck.seed + i} onDone={next} active={active} />
                  ) : s.kind === "finale" ? (
                    <FinalePoster snap={snapshot} />
                  ) : C ? (
                    <C slide={s} data={d} hold={active ? holdFor(i) : noHold} />
                  ) : null}
                </EntranceHold.Provider>
                {active && big && <Confetti colors={recapConfetti(pal)} />}
                {active && s.play && (
                  <button type="button" onClick={() => playTarget(s.play!)} className="absolute inline-flex items-center gap-1 rounded-full text-sm font-medium"
                    style={{ right: 14 * u, bottom: 14 * u, padding: `${6 * u}px ${12 * u}px`, fontSize: 13 * u, background: "var(--rc-fg)", color: "var(--rc-bg)" }}>
                    <Play size={14 * u} aria-hidden /> Play
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {last && (
        <div className="relative z-[3] shrink-0 px-3 pb-4">
          <EndActions snap={snapshot} onReplay={() => useRecapUi.setState({ open: { snapshot, seed: newSeed(), start: 0, forceGames, forceStyle } })} onClose={closeRecapPlayer} />
        </div>
      )}
    </div>
  );
}
