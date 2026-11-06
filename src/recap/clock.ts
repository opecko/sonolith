// Recaps' notion of "now". The dev toolkit's time travel moves it (src/dev); everything else in Recaps asks here
// instead of Date.now(), so periods, unlocks and snapshots can be tried on any date. The play log keeps real time.

let offset = 0;

export const clockNow = () => Date.now() + offset;

/** Dev only: pretend it's `epochMs` (null: back to the real time). */
export function setClockTo(epochMs: number | null) {
  offset = epochMs === null ? 0 : epochMs - Date.now();
}

export const clockTraveling = () => offset !== 0;

/** A real moment on Recaps' clock (an import's real time, compared with a travelled-to cutoff). */
export const onClock = (realMs: number) => realMs + offset;
