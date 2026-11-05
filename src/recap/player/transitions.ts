// Transitions between recap cards: the outgoing card stays for a moment while the next one comes in. Pure frames
// (styles for both cards at progress p), driven by the motion engine in RecapPlayer, never by CSS animations (they
// flash on WebKitGTK when they end). With animations off the next card just appears.
import { hash } from "../random";

export type TransitionKind = "push" | "wipe" | "circle" | "rise" | "diagonal" | "zoom";
export const TRANSITIONS: TransitionKind[] = ["push", "wipe", "circle", "rise", "diagonal", "zoom"];
export const TRANSITION_MS = 560;

/** Big reveals open like a spotlight; other cards vary, stable for the deck's seed. */
export function pickTransition(seed: number, index: number, kind: string): TransitionKind {
  if (kind === "topArtist" || kind === "topTrack" || kind === "finale" || kind === "persona") return "circle";
  const plain = TRANSITIONS.filter((t) => t !== "circle");
  return plain[hash(`${seed}|${index}`) % plain.length];
}

export interface Frame {
  transform?: string;
  clipPath?: string;
  opacity?: string;
}

/**
 * Styles of the incoming and the outgoing card at eased progress `p` (0 → 1); `dir` is 1 going forward, −1 back.
 * At p = 1 the incoming card has no transform or clip left.
 */
export function transitionFrame(kind: TransitionKind, p: number, dir: 1 | -1): { in: Frame; out: Frame } {
  const q = Math.max(0, Math.min(1, p));
  if (q >= 1) return { in: { transform: "none", clipPath: "none", opacity: "1" }, out: {} };
  switch (kind) {
    case "push":
      return { in: { transform: `translateX(${(1 - q) * 100 * dir}%)` }, out: { transform: `translateX(${-q * 100 * dir}%)` } };
    case "wipe":
      return {
        in: { clipPath: dir > 0 ? `inset(0 0 0 ${(1 - q) * 100}%)` : `inset(0 ${(1 - q) * 100}% 0 0)` },
        out: { transform: `translateX(${-q * 18 * dir}%)`, opacity: String(1 - q * 0.5) },
      };
    case "circle":
      return { in: { clipPath: `circle(${q * 80}% at 50% 50%)` }, out: { transform: `scale(${1 - q * 0.06})`, opacity: String(1 - q * 0.6) } };
    case "rise":
      return { in: { transform: `translateY(${(1 - q) * 100 * dir}%)` }, out: { transform: `scale(${1 - q * 0.1})`, opacity: String(1 - q * 0.5) } };
    case "diagonal": {
      // A slanted edge sweeping across: the polygon's top edge leads the bottom one by 40 %.
      const x = q * 140;
      const poly = dir > 0
        ? `polygon(${100 - x}% 0, 100% 0, 100% 100%, ${100 - x + 40}% 100%)`
        : `polygon(0 0, ${x}% 0, ${x - 40}% 100%, 0 100%)`;
      return { in: { clipPath: poly }, out: { opacity: String(1 - q * 0.4) } };
    }
    case "zoom":
      return { in: { transform: `scale(${0.85 + q * 0.15})`, opacity: String(q) }, out: { transform: `scale(${1 + q * 0.08})`, opacity: String(1 - q) } };
  }
}
