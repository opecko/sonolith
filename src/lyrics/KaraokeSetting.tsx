import { useLayoutEffect, useRef } from "react";
import { ticker } from "../motion";
import { useSettings } from "../stores/settings";
import { createKaraoke, KARAOKE_NAMES, KARAOKE_STYLES, type KaraokeStyle } from "./karaoke";
import type { LyricLine } from "./pick";

/** A sample line sung in a loop for the previews. */
const SAMPLE: LyricLine[] = [
  {
    start: 300,
    text: "Sing along with every word",
    words: ["Sing ", "a", "long ", "with ", "ev", "ery ", "word"].map((text, i) => ({ start: 300 + i * 320, end: 300 + (i + 1) * 320, text })),
  },
];
const LOOP_MS = 3600;

/** One style singing the sample line; with animations off it holds a half-sung Simple frame. */
function Preview({ style }: { style: KaraokeStyle }) {
  const ref = useRef<HTMLOListElement>(null);
  const animations = useSettings((s) => s.appearance.animations);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const k = createKaraoke(ref.current, SAMPLE, animations ? style : "simple");
    k.update(1400);
    if (!animations) return () => k.dispose();
    let t = 1400;
    const stop = ticker((dt) => {
      t = (t + dt * 1000) % LOOP_MS;
      k.update(t);
    });
    return () => {
      stop();
      k.dispose();
    };
  }, [style, animations]);
  return (
    <ol ref={ref} className="lyrics-synced lyrics-demo pointer-events-none" aria-hidden>
      <li data-i={0}>{SAMPLE[0].words!.map((w, i) => <span key={i} data-w="">{w.text}</span>)}</li>
    </ol>
  );
}

/** The four styles as radio cards, each singing the sample line; `card` styles a card (Settings vs the welcome). */
export function KaraokeChoices({ card, label, className = "" }: { card: (on: boolean) => string; label: (on: boolean) => string; className?: string }) {
  const value = useSettings((s) => s.karaokeStyle);
  return (
    <div role="radiogroup" aria-label="Karaoke style" className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${className}`}>
      {KARAOKE_STYLES.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} onClick={() => useSettings.getState().set({ karaokeStyle: s })} className={card(value === s)}>
          <p className={label(value === s)}>{KARAOKE_NAMES[s]}</p>
          <Preview style={s} />
        </button>
      ))}
    </div>
  );
}
