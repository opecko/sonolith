// The cover aura behind the recap card: the cover drawn into a tiny canvas the browser stretches over the stage
// (soft without any blur filter, like Now Playing's ambient light), under a scrim in the palette's stage color. A new
// cover fades in over the old one on the motion engine (instant with animations off).
import { useEffect, useRef } from "react";
import { tween } from "../../motion";

const SIZE = 14;

function draw(canvas: HTMLCanvasElement, src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(false);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

export default function Aura({ src }: { src: string | undefined }) {
  const a = useRef<HTMLCanvasElement>(null);
  const b = useRef<HTMLCanvasElement>(null);
  const front = useRef<"a" | "b">("a");
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!src || src === shown.current) return;
    shown.current = src;
    let stop = () => {};
    let live = true;
    const next = front.current === "a" ? b.current : a.current;
    const prev = front.current === "a" ? a.current : b.current;
    if (!next || !prev) return;
    void draw(next, src).then((ok) => {
      if (!ok || !live) return;
      front.current = front.current === "a" ? "b" : "a";
      next.style.zIndex = "1";
      prev.style.zIndex = "0";
      stop = tween(900, (t) => t * t * (3 - 2 * t), (p) => (next.style.opacity = String(p)), () => (prev.style.opacity = "0"));
    });
    return () => {
      live = false;
      stop();
    };
  }, [src]);
  const style = { width: "100%", height: "100%", opacity: 0 } as const;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <canvas ref={a} width={SIZE} height={SIZE} className="absolute inset-0" style={style} />
      <canvas ref={b} width={SIZE} height={SIZE} className="absolute inset-0" style={style} />
      <div className="absolute inset-0" style={{ zIndex: 2, background: "color-mix(in srgb, var(--rc-stage) 58%, transparent)" }} />
    </div>
  );
}
