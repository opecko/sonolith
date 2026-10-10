import { coverAccentTokens, dominantColor } from "../theme/coverColor";
import { effectiveTokens } from "../theme/index";
import type { TokenMap } from "../theme/tokens";
import { usePlayer } from "./player";
import { useSettings } from "./settings";

/** Artwork color of the current track, or null (option off, no art, or the image couldn't be read). */
let color: string | null = null;

function readColor(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 32;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx?.drawImage(img, 0, 0, 32, 32);
        resolve(ctx ? dominantColor(ctx.getImageData(0, 0, 32, 32).data) : null);
      } catch {
        resolve(null); // no CORS for this host
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Tokens the "Accent from artwork" option layers over the palette (empty when off). */
export function coverTokens(): Partial<TokenMap> {
  const a = useSettings.getState().appearance;
  if (!a.coverAccent || !color) return {};
  const t = effectiveTokens(a);
  return coverAccentTokens(color, t.bg, t.text);
}

/** Follows the current track's artwork while the option is on; `onChange` re-applies the theme. */
export function initCoverAccent(onChange: () => void) {
  let src = "";
  const update = () => {
    const p = usePlayer.getState();
    const next = useSettings.getState().appearance.coverAccent ? p.queue[p.index]?.thumbnail ?? "" : "";
    if (next === src) return;
    src = next;
    if (!next) {
      if (color) {
        color = null;
        onChange();
      }
      return;
    }
    void readColor(next).then((c) => {
      if (src !== next) return;
      color = c;
      onChange();
    });
  };
  usePlayer.subscribe(update);
  useSettings.subscribe(update);
  update();
}
