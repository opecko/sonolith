// The slide styles' metadata: what each can show (data shapes) and its layout family. The deck builder only needs
// this; the renderers are in player/styles/ (one component per style, registered by id). Adding a style: add it
// here and in player/styles/index.tsx (docs/dev/recap.md, "Adding a slide style").

/** The kinds of data a slide carries. */
export type Shape = "number" | "rank" | "hero" | "series" | "calendar" | "pair" | "text" | "covers";

export interface StyleMeta {
  id: StyleId;
  name: string;
  /** Slides in a row never share a family (two "bars" styles look too alike back to back). */
  family: string;
  shapes: Shape[];
  /** Only series of this length (the 24 hour clock). */
  seriesLength?: number;
}

export const STYLES = [
  { id: "podium", name: "Podium", family: "podium", shapes: ["rank"] },
  { id: "numeralStack", name: "Stack of numerals", family: "stack", shapes: ["rank", "number"] },
  { id: "crateFlip", name: "Vinyl crate flip", family: "crate", shapes: ["rank", "hero"] },
  { id: "marquee", name: "Marquee rows", family: "marquee", shapes: ["rank", "number", "text"] },
  { id: "poster", name: "Full-bleed poster", family: "poster", shapes: ["hero", "text", "number"] },
  { id: "receipt", name: "Receipt", family: "receipt", shapes: ["rank", "number", "pair"] },
  { id: "risingBars", name: "Rising bars", family: "bars", shapes: ["series", "rank"] },
  { id: "bubbles", name: "Packed bubbles", family: "bubbles", shapes: ["rank"] },
  { id: "odometer", name: "Odometer", family: "odometer", shapes: ["number"] },
  { id: "giantNumber", name: "Giant number", family: "giant", shapes: ["number"] },
  { id: "radialClock", name: "24-hour clock", family: "radial", shapes: ["series"], seriesLength: 24 },
  { id: "heatmap", name: "Calendar heatmap", family: "grid", shapes: ["calendar"] },
  { id: "waveform", name: "Waveform", family: "wave", shapes: ["calendar", "series"] },
  { id: "timeline", name: "Timeline with pins", family: "timeline", shapes: ["series", "pair"] },
  { id: "tradingCard", name: "Trading card", family: "card", shapes: ["hero"] },
  { id: "stickers", name: "Sticker sheet", family: "stickers", shapes: ["rank", "text", "covers"] },
  { id: "chat", name: "Chat bubbles", family: "chat", shapes: ["text", "hero", "number"] },
  { id: "terminal", name: "Terminal printout", family: "terminal", shapes: ["number", "rank", "text"] },
  { id: "newspaper", name: "Newspaper headline", family: "press", shapes: ["hero", "number"] },
  { id: "ticket", name: "Boarding pass", family: "ticket", shapes: ["hero", "pair"] },
  { id: "albumWall", name: "Album wall", family: "mosaic", shapes: ["covers", "rank"] },
  { id: "equalizer", name: "Equalizer", family: "eq", shapes: ["series", "rank"] },
  { id: "spotlight", name: "Spotlight", family: "spotlight", shapes: ["hero"] },
  { id: "versus", name: "Head to head", family: "split", shapes: ["pair"] },
  { id: "countdown", name: "Countdown reveal", family: "countdown", shapes: ["rank", "hero", "text"] },
  { id: "scratch", name: "Scratch card", family: "scratch", shapes: ["hero", "number"] },
  { id: "constellation", name: "Constellation", family: "constellation", shapes: ["rank", "covers"] },
  { id: "splitFlap", name: "Split-flap board", family: "flap", shapes: ["number", "rank", "text"] },
  { id: "polaroids", name: "Polaroids", family: "photo", shapes: ["rank", "covers", "hero"] },
  { id: "cassette", name: "Cassette tape", family: "tape", shapes: ["hero", "text"] },
  { id: "donut", name: "Donut chart", family: "donut", shapes: ["series", "rank"] },
  { id: "slotMachine", name: "Slot machine", family: "slot", shapes: ["number", "hero"] },
  { id: "magazine", name: "Magazine cover", family: "magazine", shapes: ["hero"] },
  { id: "medal", name: "Medal", family: "award", shapes: ["hero", "number"] },
  { id: "forecast", name: "Weekly forecast", family: "forecast", shapes: ["series"], seriesLength: 7 },
] as const satisfies readonly { id: string; name: string; family: string; shapes: readonly Shape[]; seriesLength?: number }[];

export type StyleId = (typeof STYLES)[number]["id"];

export const STYLE_IDS: StyleId[] = STYLES.map((s) => s.id);

export function styleMeta(id: StyleId): StyleMeta {
  const s = STYLES.find((x) => x.id === id)!;
  return { ...s, shapes: [...s.shapes] } as StyleMeta;
}

/** Whether a style can show a slide of this shape (and series length). */
export function fits(id: StyleId, shape: Shape, seriesLength?: number): boolean {
  const m = styleMeta(id);
  if (!m.shapes.includes(shape)) return false;
  return m.seriesLength === undefined || m.seriesLength === seriesLength;
}
