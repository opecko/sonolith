// Number and time formatting for Recaps (English, thousands separators).

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Whole minutes of listening. */
export const minutesOf = (ms: number) => Math.round(ms / 60_000);

/** "45 min", "3 h 20 min", "1,204 h". */
export function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return h >= 100 || m === 0 ? `${fmtInt(h)} h` : `${h} h ${m} min`;
}

/** "1 play", "3 plays". */
export const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/** 1 decimal under 10, whole numbers above. */
export const approx = (x: number) => (x < 10 ? (Math.round(x * 10) / 10).toLocaleString("en-US") : fmtInt(x));

export const HOURS_LABEL = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);
