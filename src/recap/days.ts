// Local calendar days as integers (days since 1970-01-01 in the local calendar), so day math ignores DST: a day is a
// date, never 24 hours.

/** The local calendar day of a moment. */
export function dayOf(epochMs: number): number {
  const d = new Date(epochMs);
  return dayFromYmd(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Day number of a local date (month 0-based; out-of-range days roll over like Date does). */
export const dayFromYmd = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / 86_400_000);

/** The local date of a day number. */
export function ymdOf(day: number): { y: number; m: number; d: number; weekday: number } {
  const u = new Date(day * 86_400_000);
  return { y: u.getUTCFullYear(), m: u.getUTCMonth(), d: u.getUTCDate(), weekday: u.getUTCDay() };
}

/** Local midnight at the start of a day, epoch ms (DST-correct). */
export function startOfDay(day: number): number {
  const { y, m, d } = ymdOf(day);
  return new Date(y, m, d).getTime();
}

export const daysInMonth = (y: number, m: number) => dayFromYmd(y, m + 1, 1) - dayFromYmd(y, m, 1);

/** Local hour (0–23) of a moment. */
export const hourOf = (epochMs: number) => new Date(epochMs).getHours();

/** "Nov 5, 2026" in English, from a day number. */
export function formatDay(day: number, withYear = true): string {
  const { y, m, d } = ymdOf(day);
  return `${MONTHS_SHORT[m]} ${d}${withYear ? `, ${y}` : ""}`;
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
