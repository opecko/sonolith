// Shared pieces for recap card styles: props, fonts, the cover image, headline block and ways to read any slide's
// data as a list or a big line, so each style can draw every shape it declares.
import { Music } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { hiResArt } from "../../api/art";
import { sizedArt } from "../../components/Thumb";
import type { Slide } from "../deck";
import type { Item, SlideData } from "../slides";
import { U } from "./anim";

export interface StyleProps {
  slide: Slide;
  /** What to draw: the slide's data, or its alternative when the style fits that shape. */
  data: SlideData;
  /** Holds auto-advance while the card waits for the user (scratch card). */
  hold: (on: boolean) => void;
}

/** The bundled variable font (weights 100–900), and system mono / serif stacks for printed looks. */
export const SANS = `"Google Sans Flex", "Inter", system-ui, sans-serif`;
export const MONO = `ui-monospace, "JetBrains Mono", "DejaVu Sans Mono", monospace`;
export const SERIF = `ui-serif, Georgia, "DejaVu Serif", "Times New Roman", serif`;

/** The card's base: its palette's background and text, the card unit for sizes. */
export const cardBase: CSSProperties = { background: "var(--rc-bg)", color: "var(--rc-fg)", fontFamily: SANS };

/** Cover art at a card size (units); a plain note on a colored square when there's none. */
export function Cover({ src, size, round = false, style, className = "", e }: { src?: string; size: number; round?: boolean; style?: CSSProperties; className?: string; e?: string }) {
  const px = Math.round(size * 2.4);
  const url = src ? (size >= 140 ? hiResArt(src) : sizedArt(src, px)) : undefined;
  return (
    <div data-e={e} className={`overflow-hidden ${className}`}
      style={{ width: U(size), height: U(size), borderRadius: round ? "50%" : U(size / 14), background: "var(--rc-bg2)", flexShrink: 0, ...style }}>
      {url ? <img src={url} alt="" draggable={false} referrerPolicy="no-referrer" decoding="async" className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center" style={{ color: "var(--rc-muted)" }}><Music aria-hidden style={{ width: U(size * 0.4), height: U(size * 0.4) }} /></div>}
    </div>
  );
}

/** The card's headline and sub line. */
export function Head({ slide, style, className = "", subStyle, e = "head" }: { slide: Slide; style?: CSSProperties; className?: string; subStyle?: CSSProperties; e?: string }) {
  return (
    <div data-e={e} className={className} style={style}>
      <h2 style={{ fontSize: U(26), lineHeight: 1.12, fontWeight: 750, letterSpacing: U(-0.4), margin: 0, overflowWrap: "anywhere" }}>{slide.headline}</h2>
      {slide.sub && <p style={{ marginTop: U(8), fontSize: U(14), color: "var(--rc-muted)", lineHeight: 1.35, ...subStyle }}>{slide.sub}</p>}
    </div>
  );
}

/** Any slide's data as items (a ranked list, covers, a series, a pair, a hero, a number, text lines). */
export function listOf(d: SlideData): Item[] {
  switch (d.shape) {
    case "rank":
      return d.items;
    case "covers":
      return d.images.map((image, i) => ({ label: `#${i + 1}`, image }));
    case "series":
      return d.labels.map((label, i) => ({ label, value: d.values[i], valueText: `${d.values[i]} ${d.unit}` }));
    case "pair":
      return [d.left, d.right];
    case "hero":
      return [d.item];
    case "number":
      return [{ label: d.display, sub: d.unit, valueText: d.caption }];
    case "calendar":
      return d.days.map((x) => ({ label: String(x.day), value: x.value }));
    case "text":
      return [{ label: d.big }, ...d.lines.map((label) => ({ label }))];
  }
}

/** The one line a card is about. */
export function bigText(d: SlideData): string {
  switch (d.shape) {
    case "number":
      return d.display;
    case "hero":
      return d.item.label;
    case "text":
      return d.big;
    case "pair":
      return d.verdict ?? `${d.left.label} / ${d.right.label}`;
    default:
      return listOf(d)[0]?.label ?? "";
  }
}

/** Smaller text under the big line. */
export function smallText(d: SlideData): string {
  switch (d.shape) {
    case "number":
      return [d.unit, d.caption].filter(Boolean).join(" · ");
    case "hero":
      return [d.item.sub, d.stat].filter(Boolean).join(" · ");
    case "text":
      return d.lines.join(" ");
    default:
      return "";
  }
}

/** A number of card units scaled down for long text, so it fits a width. */
export const fitSize = (text: string, max: number, width: number, perChar = 0.62) => Math.min(max, width / Math.max(1, text.length * perChar));

export const Fill = ({ children, style, className = "" }: { children: ReactNode; style?: CSSProperties; className?: string }) => (
  <div className={`absolute inset-0 overflow-hidden ${className}`} style={{ ...cardBase, ...style }}>{children}</div>
);

/** A deterministic pseudo-random number in [0, 1) for item `i` of a card (stable layouts without state). */
export const jitter = (i: number, salt = 1) => {
  const x = Math.sin((i + 1) * 12.9898 * salt) * 43758.5453;
  return x - Math.floor(x);
};
