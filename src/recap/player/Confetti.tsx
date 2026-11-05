// A short burst of confetti on a canvas (at most 150 pieces) for the big moments. It runs on the motion ticker and
// stops once every piece has fallen; with animations off there's none at all.
import { useEffect, useRef } from "react";
import { motionOn, ticker } from "../../motion";

const MAX = 150;

export default function Confetti({ colors, count = 120 }: { colors: string[]; count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !motionOn()) return;
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    const w = c.width, h = c.height;
    const bits = Array.from({ length: Math.min(MAX, count) }, (_, i) => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * w * 1.4,
      vy: -h * (0.5 + Math.random() * 0.7),
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 12,
      s: 4 + Math.random() * 6,
      color: colors[i % colors.length],
    }));
    let stop = () => {};
    stop = ticker((dt) => {
      ctx.clearRect(0, 0, w, h);
      let alive = 0;
      for (const b of bits) {
        b.vy += h * 1.6 * dt;
        b.vx *= 1 - 1.5 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.r += b.vr * dt;
        if (b.y > h + 20) continue;
        alive++;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        ctx.restore();
      }
      if (!alive) {
        stop();
        ctx.clearRect(0, 0, w, h);
      }
    });
    return () => stop();
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
