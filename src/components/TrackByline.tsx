import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import type { Track } from "../api/types";
import { useNav } from "../stores/nav";
import { useUi } from "../stores/ui";

export type BylinePart = string | { kind: "artist" | "album"; id: string; text: string };

const SEPARATORS = " ,&•·/";
const boundary = (s: string, i: number) => i <= 0 || i >= s.length || SEPARATORS.includes(s[i - 1]) || SEPARATORS.includes(s[i]);

/**
 * Splits a track's byline text into plain text and links: every artist with a browse id and the album (when it
 * has one) become links where their names appear as whole words. Text the track has no id for (a "Song" label,
 * plays, a year) stays as it is, so the line reads exactly like before.
 */
export function bylineParts(text: string, t: Track): BylinePart[] {
  const links: { kind: "artist" | "album"; id: string; name: string }[] = [];
  t.artists.forEach((name, i) => {
    const id = t.artistIds?.[i];
    if (id && name) links.push({ kind: "artist", id, name });
  });
  if (t.album?.id && t.album.title) links.push({ kind: "album", id: t.album.id, name: t.album.title });
  if (!links.length || !text) return text ? [text] : [];
  // Longest first, so "Simon & Garfunkel" wins over a "Simon" at the same spot.
  links.sort((a, b) => b.name.length - a.name.length);
  const out: BylinePart[] = [];
  let pos = 0;
  while (pos < text.length) {
    let best: { at: number; link: (typeof links)[number] } | null = null;
    for (const link of links) {
      let at = text.indexOf(link.name, pos);
      while (at >= 0 && !(boundary(text, at) && boundary(text, at + link.name.length))) at = text.indexOf(link.name, at + 1);
      if (at >= 0 && (!best || at < best.at)) best = { at, link };
    }
    if (!best) break;
    if (best.at > pos) out.push(text.slice(pos, best.at));
    out.push({ kind: best.link.kind, id: best.link.id, text: best.link.name });
    pos = best.at + best.link.name.length;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

/**
 * A track's byline with its artist and album names as links. The links carry only `data-*` attributes: one
 * delegated handler at the app's root (`browseLinks`) follows them, so a row gets no closures or state of its own.
 */
export function Byline({ track, text = track.subtitle }: { track: Track; text?: string }): ReactNode {
  return bylineParts(text, track).map((p, i) =>
    typeof p === "string" ? p : (
      <span key={i} role="link" tabIndex={0} data-link={p.kind} data-id={p.id} className="track-link">{p.text}</span>
    ),
  );
}

function follow(e: MouseEvent | KeyboardEvent): boolean {
  const el = (e.target as Element).closest?.<HTMLElement>("[data-link]");
  const id = el?.dataset.id;
  const kind = el?.dataset.link;
  if (!el || !id || (kind !== "artist" && kind !== "album") || !(e.currentTarget as Element).contains(el)) return false;
  // Before anything else sees it: the row around the link must not also play the track.
  e.preventDefault();
  e.stopPropagation();
  useUi.getState().setNowPlaying(false);
  useNav.getState().go({ name: kind, id });
  return true;
}

/**
 * Spread on the app's root: follows a clicked or Enter-pressed byline link in the capture phase, so the row's own
 * click (play) never runs. Anything else passes through untouched.
 */
export const browseLinks = {
  onClickCapture: (e: MouseEvent) => void follow(e),
  onKeyDownCapture: (e: KeyboardEvent) => {
    if (e.key === "Enter") follow(e);
  },
};
