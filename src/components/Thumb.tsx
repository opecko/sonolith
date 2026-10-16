import { memo } from "react";

const SIZED = /=w(\d+)-h\d+(-[a-z0-9-]+)?$/i;

/**
 * googleusercontent art for a `px`-sized slot, at 2× for sharp HiDPI: list rows otherwise decode 240–450 px images
 * for a 40 px square and rescale them on every repaint. Other URLs (i.ytimg video frames) stay as they are.
 */
export function sizedArt(src: string, px: number): string {
  const m = SIZED.exec(src);
  const w = px * 2;
  return m && Number(m[1]) > w ? src.replace(SIZED, `=w${w}-h${w}-l90-rj`) : src;
}

/** Plain <img> on a placeholder background: no load-state gating (WebKitGTK can miss load events on lazy images). */
function Thumb({ src, className = "", round = false, px }: { src?: string; className?: string; round?: boolean; px?: number }) {
  const url = src && px ? sizedArt(src, px) : src;
  return (
    <div className={`overflow-hidden bg-[var(--c-surface-2)] ${round ? "rounded-full" : "m3-art rounded-[var(--radius)]"} ${className}`}>
      {url && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
    </div>
  );
}

export default memo(Thumb);
