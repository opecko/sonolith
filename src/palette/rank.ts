// Command palette matching (pure): which commands a query finds, best first.

export interface PaletteItem {
  id: string;
  title: string;
  /** Group shown next to the title ("Go to", "Playback", "Settings"…). */
  group: string;
  /** Other words it should be found by. */
  keywords?: string[];
}

/** Lower case, no diacritics ("Přehrávání" → "prehravani"), single spaces. */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** `q`'s letters in order inside `s` ("np" in "now playing"). */
const subsequence = (q: string, s: string) => {
  let i = 0;
  for (const c of s) if (c === q[i]) i++;
  return i === q.length;
};

/** How well one query word fits an item; 0 = not at all. */
function wordScore(w: string, title: string, rest: string): number {
  if (title.startsWith(w)) return 4;
  if (title.split(" ").some((t) => t.startsWith(w))) return 3;
  if (title.includes(w)) return 2;
  if (rest.split(" ").some((t) => t.startsWith(w))) return 1.5;
  if (w.length >= 2 && subsequence(w, title.replace(/ /g, ""))) return 0.5;
  return 0;
}

/** Items every query word fits, best first (ties keep the list's order). An empty query keeps the whole list. */
export function rankItems<T extends PaletteItem>(query: string, items: T[]): T[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return items;
  const scored: { item: T; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const title = fold(item.title);
    const rest = fold([item.group, ...(item.keywords ?? [])].join(" "));
    let score = 0;
    for (const w of words) {
      const s = wordScore(w, title, rest);
      if (!s) return;
      score += s;
    }
    scored.push({ item, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.item);
}
