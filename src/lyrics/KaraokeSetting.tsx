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

/** Settings → Lyrics: how word-synced lyrics show the sung words, each option with a live preview. */
export default function KaraokeSetting() {
  const value = useSettings((s) => s.karaokeStyle);
  const animations = useSettings((s) => s.appearance.animations);
  return (
    <div className="mt-4">
      <p className="text-sm font-medium">Karaoke style</p>
      <p className="mb-3 text-sm text-[var(--c-text-muted)]">
        For word-synced lyrics.{animations ? "" : " Animations are off, so every style shows as Simple."}
      </p>
      <div role="radiogroup" aria-label="Karaoke style" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {KARAOKE_STYLES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={value === s} onClick={() => useSettings.getState().set({ karaokeStyle: s })}
            className={`m3-choice rounded-[var(--radius)] border p-3 text-left ${value === s ? "border-[var(--c-accent)]" : "border-[var(--c-outline)] hover:bg-[var(--c-hover)]"}`}>
            <p className={`mb-1 text-sm ${value === s ? "font-semibold" : ""}`}>{KARAOKE_NAMES[s]}</p>
            <Preview style={s} />
          </button>
        ))}
      </div>
    </div>
  );
}
