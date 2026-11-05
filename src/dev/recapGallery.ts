// Dev toolkit: a deck with one card per style (sample data from a synthetic year), to review every style in turn.
import { RECAP_MOODS } from "../theme/recapPalette";
import type { Deck, Slide } from "../recap/deck";
import { MONTHS } from "../recap/days";
import { buildContents, type SlideContent } from "../recap/slides";
import type { Snapshot } from "../recap/snapshot";
import { fits, STYLES, type StyleId } from "../recap/styles";

const fitsData = (id: StyleId, d: SlideContent["data"]) => fits(id, d.shape, d.shape === "series" ? d.values.length : undefined);

/** Every style once, each on the first card whose data (or alternative) it can draw, cycling through moods. */
export function galleryDeck(snap: Snapshot): Deck {
  const label = snap.period.kind === "year" ? String(snap.period.year) : MONTHS[snap.period.month];
  const contents = buildContents(snap.stats, { period: snap.period, label, span: "this year", seed: 1 }, {
    coveredFrom: snap.coveredFrom, periodStart: snap.lastDay - snap.stats.daysInPeriod + 1, youtube: false, log: true,
  });
  const slides: Slide[] = [];
  STYLES.forEach((st, i) => {
    // Prefer a card nobody used yet, so the gallery shows varied data too.
    const used = new Set(slides.map((s) => s.kind));
    const fitting = contents.filter((c) => fitsData(st.id, c.data) || (c.alt && fitsData(st.id, c.alt)));
    const c = fitting.find((x) => !used.has(x.kind)) ?? fitting[0];
    if (!c) return;
    slides.push({
      ...c,
      sub: `Style ${i + 1} of ${STYLES.length}: ${st.name}`,
      duration: 8000,
      style: st.id,
      useAlt: !fitsData(st.id, c.data),
      mood: RECAP_MOODS[i % RECAP_MOODS.length],
    });
  });
  return { seed: 1, slides };
}
