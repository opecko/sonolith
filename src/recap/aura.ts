// The "aura" behind a recap card: a cover washed across the whole stage. It starts as the song you last played and
// changes only at the big moments (your top artist, your song, a repeat champion…), then stays until the next one,
// so it never flickers from card to card. Pure: which cover each card shows.
import type { Slide } from "./deck";

/** Cards that bring their own cover to the aura. */
const MOMENTS = new Set(["topArtist", "topTrack", "topTracks", "repeatChampion", "obsessionWeek", "mostSkipped", "artistLoyalty", "discoveries"]);

function momentImage(s: Slide): string | undefined {
  if (!MOMENTS.has(s.kind)) return undefined;
  for (const d of [s.data, s.alt]) {
    if (!d) continue;
    if (d.shape === "hero" && d.item.image) return d.item.image;
    if (d.shape === "rank" && d.items[0]?.image) return d.items[0].image;
  }
  return undefined;
}

/** The aura cover of every card: `start` until the first moment, then the latest moment's cover. */
export function auraTrail(slides: Slide[], start: string | undefined): (string | undefined)[] {
  let current = start;
  return slides.map((s) => (current = momentImage(s) ?? current));
}
