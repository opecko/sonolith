import { create } from "zustand";
import { tween } from "../motion";
import { mixTokens, schemeTokens, sourceColor } from "../theme/albumScheme";
import { isLight } from "../theme/color";
import { applyScopedTheme, clearScopedTheme, effectiveTokens } from "../theme/index";
import type { TokenMap } from "../theme/tokens";
import { usePlayer } from "./player";
import { useSettings } from "./settings";

/** Source color per cover URL (null = couldn't be read); a cover is decoded and quantized once per session. */
const sources = new Map<string, number | null>();
/** Generated token sets per cover and light/dark. */
const schemes = new Map<string, TokenMap>();

function readSource(src: string): Promise<number | null> {
  const known = sources.get(src);
  if (known !== undefined) return Promise.resolve(known);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    const done = (c: number | null) => {
      sources.set(src, c);
      resolve(c);
    };
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx?.drawImage(img, 0, 0, 64, 64);
        done(ctx ? sourceColor(ctx.getImageData(0, 0, 64, 64).data) : null);
      } catch {
        done(null); // no CORS for this host
      }
    };
    img.onerror = () => done(null);
    img.src = src;
  });
}

/** The generated scheme Settings should check (target of any running transition); null = the palette applies. */
export const useCoverScheme = create<{ tokens: TokenMap | null }>(() => ({ tokens: null }));

/** What is painted right now: the scheme, a mix while changing tracks, or null (the palette). */
let shown: TokenMap | null = null;

/** Tokens "Colors from album art" puts between the palette and the user's own overrides on <html> (empty when
 * off or when only Now Playing takes them). */
export const coverTokens = (): Partial<TokenMap> => (useSettings.getState().appearance.coverColors === "app" ? shown ?? {} : {});

/** Now Playing's root: themed on its own when the setting is "Now Playing only". */
let scope: HTMLElement | null = null;

export function setCoverScope(el: HTMLElement | null) {
  if (scope && scope !== el) clearScopedTheme(scope);
  scope = el;
  paintCoverScope();
}

/** Puts the cover's scheme (or the transition to it) on Now Playing alone, or takes it off. */
export function paintCoverScope() {
  if (!scope) return;
  const a = useSettings.getState().appearance;
  if (a.coverColors === "nowPlaying" && shown) applyScopedTheme(scope, a, shown);
  else if (scope.dataset.themeScope !== undefined) clearScopedTheme(scope);
}

/**
 * Follows the current track's cover while "Colors from album art" is on and re-applies the theme through
 * `onChange`. A new scheme fades in over one short tween (instant with animations off or while hidden); with no
 * cover or an unreadable one it fades back to the palette. Nothing is computed while the window is hidden: the
 * latest track is picked up when it shows again.
 */
export function initCoverColors(onChange: () => void) {
  let key = "";
  let stop = () => {};
  let pending = false;
  const paletteNow = () => effectiveTokens(useSettings.getState().appearance);
  const show = (next: TokenMap | null) => {
    useCoverScheme.setState({ tokens: next });
    stop();
    const from = shown ?? paletteNow();
    const to = next ?? paletteNow();
    stop = tween(260, (t) => 1 - (1 - t) ** 3, (p) => {
      shown = mixTokens(from, to, p);
      onChange();
    }, () => {
      shown = next;
      onChange();
    });
  };
  // The palette's own lightness decides light/dark (a palette without the chosen mode shows its other one);
  // recomputed only when the appearance changes, since this runs on every player update.
  let darkFor: unknown = null, dark = true;
  const update = () => {
    const a = useSettings.getState().appearance;
    const p = usePlayer.getState();
    const src = a.coverColors !== "off" ? p.queue[p.index]?.thumbnail ?? "" : "";
    if (!src && !key) return;
    if (darkFor !== a) {
      darkFor = a;
      dark = !isLight(paletteNow().bg);
    }
    const next = src ? `${src}|${dark ? "d" : "l"}` : "";
    if (next === key) return;
    if (document.hidden) {
      pending = true;
      return;
    }
    key = next;
    if (!src) {
      if (shown || useCoverScheme.getState().tokens) show(null);
      return;
    }
    void readSource(src).then((c) => {
      if (key !== next) return;
      if (c === null) return show(null);
      let t = schemes.get(next);
      if (!t) schemes.set(next, (t = schemeTokens(c, dark)));
      show(t);
    });
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && pending) {
      pending = false;
      update();
    }
  });
  usePlayer.subscribe(update);
  useSettings.subscribe(update);
  update();
}
