// Ranked lists, covers and single heroes: podium, vinyl crate flip, packed bubbles, constellation, album wall, sticker
// sheet, countdown reveal, spotlight, trading card.
import { useRef, useState } from "react";
import { clamp01, easeBack, easeInOut, easeOut, parts, stagger, U, useEntrance, useLoop } from "../anim";
import { bigText, Cover, Fill, fitSize, Head, jitter, listOf, smallText, type StyleProps } from "../parts";
import type { Item } from "../../slides";

export function Podium({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const items = listOf(data).slice(0, 5);
  const top = [items[1], items[0], items[2]];
  const heights = [120, 170, 90];
  useEntrance(1700, (p) => {
    parts(root.current, "block").forEach((el, i) => {
      // Third place rises first, the winner last.
      const order = [1, 2, 0][i];
      el.style.height = `calc(var(--u) * ${heights[i] * easeBack(stagger(p, order, 3, 0.5))})`;
    });
    for (const [i, el] of parts(root.current, "rest").entries()) el.style.opacity = String(clamp01((p - 0.7 - i * 0.1) / 0.2));
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22) }}>
        <Head slide={slide} />
        <div className="flex flex-1 items-end justify-center" style={{ gap: U(8), marginTop: U(10) }}>
          {top.map((it, i) =>
            it ? (
              <div key={i} className="flex flex-col items-center" style={{ width: U(100), gap: U(6) }}>
                <Cover src={it.image} size={i === 1 ? 84 : 68} round />
                <p className="w-full text-center" style={{ fontSize: U(13), fontWeight: 700, lineHeight: 1.15, overflowWrap: "anywhere", maxHeight: U(46), overflow: "hidden" }}>{it.label}</p>
                <div data-e="block" className="flex w-full items-start justify-center" style={{ height: U(heights[i]), background: i === 1 ? "var(--rc-accent)" : "var(--rc-bg2)", color: i === 1 ? "var(--rc-on-accent)" : "var(--rc-fg)", borderRadius: `${U(10)} ${U(10)} 0 0`, overflow: "hidden" }}>
                  <span style={{ fontSize: U(40), fontWeight: 900, marginTop: U(6) }}>{[2, 1, 3][i]}</span>
                </div>
              </div>
            ) : <div key={i} style={{ width: U(100) }} />,
          )}
        </div>
        <div style={{ borderTop: `${U(2)} solid var(--rc-fg)`, paddingTop: U(10) }}>
          {items.slice(3).map((it, i) => (
            <p data-e="rest" key={i} className="truncate" style={{ fontSize: U(15), lineHeight: 1.6 }}><b>{i + 4}.</b> {it.label} <span style={{ color: "var(--rc-muted)" }}>{it.valueText}</span></p>
          ))}
        </div>
      </div>
    </Fill>
  );
}

/** Flipping through record sleeves in a crate until #1 faces you; a hero slides its record out of the sleeve. */
export function CrateFlip({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const items = data.shape === "hero" ? [data.item] : listOf(data).slice(0, 5);
  const hero = data.shape === "hero";
  useEntrance(hero ? 1500 : 2200, (p) => {
    if (hero) {
      const [disc] = parts(root.current, "disc");
      if (disc) disc.style.left = `calc(var(--u) * ${30 + 120 * easeOut(clamp01((p - 0.2) / 0.8))})`;
      return;
    }
    // Sleeves from the back (#5) flip forward one by one.
    const sleeves = parts(root.current, "sleeve");
    sleeves.forEach((el, i) => {
      const k = sleeves.length - 1 - i;
      const q = easeInOut(stagger(p, k, sleeves.length, 0.75));
      el.style.transform = `perspective(calc(var(--u) * 900)) rotateX(${(1 - q) * -75}deg)`;
      el.style.top = `calc(var(--u) * ${i * 22 + (1 - q) * 60})`;
    });
  });
  if (hero) {
    const it = items[0];
    return (
      <Fill>
        <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(24), gap: U(26) }}>
          <Head slide={slide} />
          <div className="relative" style={{ height: U(240) }}>
            <div data-e="disc" className="absolute flex items-center justify-center" style={{ left: U(30), top: U(10), width: U(220), height: U(220), borderRadius: "50%", background: "var(--rc-fg)", boxShadow: `inset 0 0 0 ${U(30)} var(--rc-bg2)` }}>
              <Cover src={it.image} size={80} round />
            </div>
            <Cover src={it.image} size={240} style={{ position: "absolute", left: 0, top: 0, borderRadius: U(6) }} />
          </div>
          <div>
            <p style={{ fontSize: U(fitSize(it.label, 34, 300, 0.55)), fontWeight: 800, lineHeight: 1.05 }}>{it.label}</p>
            <p style={{ fontSize: U(15), color: "var(--rc-muted)", marginTop: U(6) }}>{smallText(data)}</p>
          </div>
        </div>
      </Fill>
    );
  }
  const back = [...items].reverse();
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22) }}>
        <Head slide={slide} />
        <div className="relative flex-1" style={{ marginTop: U(20) }}>
          {back.map((it, i) => (
            <div data-e="sleeve" key={i} className="absolute flex items-center" style={{ left: U(10 + i * 4), right: U(10 + i * 4), top: U(i * 22), height: U(300), background: i === back.length - 1 ? "var(--rc-accent)" : "var(--rc-bg2)", color: i === back.length - 1 ? "var(--rc-on-accent)" : "var(--rc-fg)", borderRadius: U(8), padding: U(14), gap: U(12), transformOrigin: "bottom center", alignItems: "flex-start", boxShadow: `0 ${U(-2)} 0 var(--rc-bg)` }}>
              <span style={{ fontSize: U(16), fontWeight: 800 }}>{back.length - i}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate" style={{ fontSize: U(17), fontWeight: 700 }}>{it.label}</p>
                <p className="truncate" style={{ fontSize: U(13), opacity: 0.85 }}>{it.sub ?? it.valueText}</p>
              </div>
              <Cover src={it.image} size={56} />
            </div>
          ))}
        </div>
      </div>
    </Fill>
  );
}

/** Circles sized by plays, packed around the biggest. */
export function Bubbles({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const items = listOf(data).slice(0, 7);
  const max = Math.max(1, ...items.map((i) => i.value ?? 1));
  const radii = items.map((it) => 34 + 66 * Math.sqrt((it.value ?? max / 2) / max));
  // Greedy packing: each circle at the first free spot on a spiral around the center.
  const placed: { x: number; y: number; r: number }[] = [];
  for (const r of radii) {
    let spot = { x: 0, y: 0 };
    for (let t = 0; t < 400; t++) {
      const a = t * 0.5, d = t * 1.6;
      const x = Math.cos(a) * d, y = Math.sin(a) * d * 1.2;
      if (placed.every((c) => Math.hypot(c.x - x, c.y - y) >= c.r + r + 4)) {
        spot = { x, y };
        break;
      }
    }
    placed.push({ ...spot, r });
  }
  useEntrance(1500, (p) => {
    parts(root.current, "bubble").forEach((el, i) => {
      const s = easeBack(stagger(p, i, items.length, 0.6));
      const r = radii[i] * s;
      el.style.width = el.style.height = `calc(var(--u) * ${r * 2})`;
      el.style.left = `calc(var(--u) * ${180 + placed[i].x - r})`;
      el.style.top = `calc(var(--u) * ${360 + placed[i].y - r})`;
    });
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0">
        <Head slide={slide} style={{ position: "absolute", top: U(24), left: U(24), right: U(24) }} />
        {items.map((it, i) => (
          <div data-e="bubble" key={i} className="absolute flex flex-col items-center justify-center overflow-hidden text-center"
            style={{ left: U(180 + placed[i].x - radii[i]), top: U(360 + placed[i].y - radii[i]), width: U(radii[i] * 2), height: U(radii[i] * 2), borderRadius: "50%", background: i === 0 ? "var(--rc-accent)" : i % 2 ? "var(--rc-bg2)" : "var(--rc-accent2)", color: i === 0 ? "var(--rc-on-accent)" : i % 2 ? "var(--rc-fg)" : "var(--rc-on-accent2)", padding: U(8) }}>
            <p style={{ fontSize: U(Math.max(11, radii[i] / 4.2)), fontWeight: 800, lineHeight: 1.05, overflowWrap: "anywhere" }}>{it.label}</p>
            {radii[i] > 55 && <p style={{ fontSize: U(11), marginTop: U(2) }}>{it.valueText}</p>}
          </div>
        ))}
      </div>
    </Fill>
  );
}

/** Artists (or covers) as stars, joined by lines drawn one after another. */
export function Constellation({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const items = listOf(data).slice(0, data.shape === "covers" ? 8 : 6);
  const pts = items.map((_, i) => ({ x: 50 + jitter(i, 3) * 260, y: 150 + (i / Math.max(1, items.length - 1)) * 400 + (jitter(i, 7) - 0.5) * 50 }));
  const len = pts.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
  useEntrance(2200, (p) => {
    const [path] = parts(root.current, "path") as unknown as SVGPathElement[];
    if (path) path.style.strokeDashoffset = String(len * (1 - easeInOut(p)));
    parts(root.current, "star").forEach((el, i) => (el.style.opacity = String(clamp01((p - i / items.length * 0.85) / 0.15))));
  });
  // Stars twinkle a little while the card is up.
  const t = useRef(0);
  useLoop((dt) => {
    t.current += dt;
    parts(root.current, "twinkle").forEach((el, i) => (el.style.opacity = String(0.4 + 0.6 * Math.abs(Math.sin(t.current * 1.3 + i)))));
  });
  return (
    <Fill style={{ background: "var(--rc-stage)" }}>
      <div ref={root} className="absolute inset-0">
        {[...Array(28)].map((_, i) => (
          <span data-e="twinkle" key={i} aria-hidden className="absolute" style={{ left: U(jitter(i, 11) * 350), top: U(jitter(i, 13) * 630), width: U(2 + jitter(i, 5) * 2), height: U(2 + jitter(i, 5) * 2), borderRadius: "50%", background: "var(--rc-muted)" }} />
        ))}
        <Head slide={slide} style={{ position: "absolute", top: U(24), left: U(24), right: U(24) }} />
        <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox="0 0 360 640" preserveAspectRatio="none">
          <path data-e="path" d={pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")} fill="none" stroke="var(--rc-accent)" strokeWidth="1.5" strokeDasharray={len} style={{ strokeDashoffset: 0 }} />
        </svg>
        {items.map((it, i) => (
          <div data-e="star" key={i} className="absolute flex items-center" style={{ left: U(pts[i].x - (it.image ? 22 : 7)), top: U(pts[i].y - (it.image ? 22 : 7)), gap: U(8) }}>
            {it.image ? <Cover src={it.image} size={44} round style={{ boxShadow: `0 0 0 ${U(2)} var(--rc-accent)` }} /> : <span style={{ width: U(14), height: U(14), borderRadius: "50%", background: i === 0 ? "var(--rc-accent)" : "var(--rc-fg)" }} />}
            {data.shape !== "covers" && <span style={{ fontSize: U(i === 0 ? 18 : 14), fontWeight: i === 0 ? 800 : 500, maxWidth: U(150), overflowWrap: "anywhere" }}>{it.label}</span>}
          </div>
        ))}
      </div>
    </Fill>
  );
}

/** A mosaic of covers revealed along the diagonal. */
export function AlbumWall({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const images = (data.shape === "covers" ? data.images : listOf(data).map((i) => i.image).filter((x): x is string => !!x));
  const n = images.length >= 16 ? 4 : images.length >= 9 ? 3 : 2;
  const tiles = Array.from({ length: n * n }, (_, i) => images[i % Math.max(1, images.length)]);
  const size = 360 / n;
  useEntrance(1600, (p) => {
    parts(root.current, "tile").forEach((el, i) => {
      const diag = (i % n) + Math.floor(i / n);
      const q = easeOut(stagger(p, diag, 2 * n - 1, 0.7));
      el.style.clipPath = `inset(0 ${(1 - q) * 100}% ${(1 - q) * 100}% 0)`;
    });
    for (const el of parts(root.current, "band")) el.style.top = `calc(var(--u) * ${640 - 180 * easeOut(clamp01((p - 0.5) / 0.5))})`;
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0">
        <div className="absolute left-0 right-0 top-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
          {tiles.map((src, i) => <Cover e="tile" key={i} src={src} size={size} style={{ borderRadius: 0 }} />)}
        </div>
        <div data-e="band" className="absolute left-0 right-0" style={{ top: U(460), height: U(180), background: "var(--rc-bg)", padding: U(22) }}>
          <Head slide={slide} />
          {data.shape === "covers" && data.caption && <p style={{ fontSize: U(14), color: "var(--rc-muted)", marginTop: U(6) }}>{data.caption}</p>}
        </div>
      </div>
    </Fill>
  );
}

/** Stickers slapped on a sheet at playful angles. */
export function Stickers({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const items: Item[] = data.shape === "text" ? [{ label: data.big }, ...data.lines.map((label) => ({ label }))] : listOf(data).slice(0, 6);
  useEntrance(1500, (p) => {
    parts(root.current, "sticker").forEach((el, i) => {
      const q = stagger(p, i, items.length, 0.65);
      const s = q <= 0 ? 0.01 : 1 + (1 - easeBack(q)) * 1.4;
      el.style.transform = `rotate(${el.dataset.rot}deg) scale(${q >= 1 ? 1 : s})`;
      el.style.visibility = q > 0 ? "visible" : "hidden";
    });
  });
  return (
    <Fill style={{ background: "var(--rc-bg2)" }}>
      <div ref={root} className="absolute inset-0">
        <Head slide={slide} style={{ position: "absolute", top: U(24), left: U(24), right: U(24) }} />
        {items.map((it, i) => {
          const rot = (jitter(i, 2) - 0.5) * 24;
          const big = i === 0;
          return (
            <div data-e="sticker" data-rot={rot} key={i} className="absolute flex items-center"
              style={{ left: U(20 + (i % 2) * 110 + jitter(i, 4) * 40), top: U(130 + i * (430 / items.length)), transform: `rotate(${rot}deg)`, gap: U(8), padding: `${U(8)} ${U(14)}`, borderRadius: U(big ? 22 : 99), border: `${U(4)} solid var(--rc-fg)`, background: big ? "var(--rc-accent)" : i % 2 ? "var(--rc-accent2)" : "var(--rc-bg)", color: big ? "var(--rc-on-accent)" : i % 2 ? "var(--rc-on-accent2)" : "var(--rc-fg)", maxWidth: U(300) }}>
              {it.image && <Cover src={it.image} size={big ? 64 : 40} round />}
              <span style={{ fontSize: U(big ? fitSize(it.label, 30, 220, 0.6) : 16), fontWeight: 800, lineHeight: 1.1, overflowWrap: "anywhere" }}>{it.label}</span>
            </div>
          );
        })}
      </div>
    </Fill>
  );
}

/** Counts down (5…1 for a list, 3‑2‑1 otherwise) and then shows the answer. */
export function Countdown({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const items = data.shape === "rank" ? listOf(data).slice(0, 5) : [];
  const steps = items.length ? items.length : 3;
  const [shown, setShown] = useState(-1);
  useEntrance(steps * 650 + 600, (p) => {
    const step = Math.min(steps, Math.floor(p * (steps + 0.9)));
    const [num] = parts(root.current, "num");
    if (num) {
      const local = (p * (steps + 0.9)) % 1;
      num.textContent = step >= steps ? "" : String(items.length ? steps - step : 3 - step);
      num.style.fontSize = `calc(var(--u) * ${120 + 160 * easeOut(local)})`;
      num.style.opacity = String(1 - local * 0.7);
    }
    if (p >= 1 || step >= steps) setShown(steps);
    else setShown(step);
  });
  const done = shown >= steps;
  return (
    <Fill style={{ background: done ? "var(--rc-bg)" : "var(--rc-stage)" }}>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(24) }}>
        <div data-e="num" aria-hidden className="absolute inset-0 flex items-center justify-center" style={{ fontWeight: 900, color: "var(--rc-accent)", pointerEvents: "none", display: done ? "none" : "flex" }} />
        {done && (
          <>
            <Head slide={slide} />
            {items.length ? (
              <ol className="flex flex-1 flex-col justify-center" style={{ gap: U(12) }}>
                {items.map((it, i) => (
                  <li key={i} className="flex items-center" style={{ gap: U(12) }}>
                    <span style={{ fontSize: U(28), fontWeight: 900, width: U(30), color: i === 0 ? "var(--rc-accent)" : "var(--rc-muted)" }}>{i + 1}</span>
                    <Cover src={it.image} size={i === 0 ? 70 : 50} />
                    <div className="min-w-0"><p className="truncate" style={{ fontSize: U(i === 0 ? 20 : 16), fontWeight: 700 }}>{it.label}</p><p className="truncate" style={{ fontSize: U(12), color: "var(--rc-muted)" }}>{it.valueText ?? it.sub}</p></div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center" style={{ gap: U(14) }}>
                {data.shape === "hero" && <Cover src={data.item.image} size={200} />}
                <p style={{ fontSize: U(fitSize(bigText(data), 54, 300, 0.58)), fontWeight: 900, lineHeight: 1 }}>{bigText(data)}</p>
                <p style={{ fontSize: U(15), color: "var(--rc-muted)" }}>{smallText(data)}</p>
              </div>
            )}
          </>
        )}
      </div>
    </Fill>
  );
}

/** A spotlight sweeps the dark stage and settles on the star. */
export function Spotlight({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const item = data.shape === "hero" ? data.item : listOf(data)[0];
  useEntrance(2000, (p) => {
    const [light] = parts(root.current, "light");
    const q = easeInOut(clamp01(p / 0.75));
    const x = 50 + Math.sin(q * Math.PI * 2.5) * 40 * (1 - q);
    const r = 34 + 40 * easeOut(clamp01((p - 0.6) / 0.4));
    if (light) light.style.background = `radial-gradient(circle at ${x}% 42%, transparent ${r}%, var(--rc-stage) ${r + 14}%)`;
    for (const el of parts(root.current, "name")) el.style.opacity = String(clamp01((p - 0.65) / 0.35));
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col items-center" style={{ padding: U(24), gap: U(16) }}>
        <Head slide={slide} style={{ textAlign: "center", position: "relative", zIndex: 2 }} />
        <div className="flex flex-1 flex-col items-center justify-center text-center" style={{ gap: U(16) }}>
          <Cover src={item?.image} size={210} round />
          <div data-e="name">
            <p style={{ fontSize: U(fitSize(item?.label ?? "", 40, 300, 0.58)), fontWeight: 900, lineHeight: 1.05 }}>{item?.label}</p>
            <p style={{ fontSize: U(15), color: "var(--rc-muted)", marginTop: U(6) }}>{smallText(data) || item?.sub}</p>
          </div>
        </div>
        <div data-e="light" aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(circle at 50% 42%, transparent 74%, var(--rc-stage) 88%)" }} />
      </div>
    </Fill>
  );
}

/** A collectible card with stats rows and a holographic shimmer that passes a few times. */
export function TradingCard({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const item = data.shape === "hero" ? data.item : listOf(data)[0];
  const stats = [data.shape === "hero" ? data.kicker : slide.headline, item?.valueText, data.shape === "hero" ? data.stat : undefined].filter((x): x is string => !!x);
  useEntrance(1400, (p) => {
    const [card] = parts(root.current, "card");
    const q = easeBack(p);
    if (card) card.style.transform = p >= 1 ? "none" : `perspective(calc(var(--u) * 800)) rotateY(${(1 - q) * 180}deg)`;
  });
  const t = useRef(0);
  useLoop((dt) => {
    if (t.current > 3.2) return;
    t.current += dt;
    const [sh] = parts(root.current, "shine");
    if (sh) sh.style.left = `${((t.current % 1.6) / 1.6) * 260 - 130}%`;
  });
  return (
    <Fill style={{ background: "var(--rc-stage)" }}>
      <div ref={root} className="absolute inset-0 flex flex-col items-center justify-center" style={{ gap: U(18), padding: U(20) }}>
        <Head slide={slide} style={{ textAlign: "center" }} />
        <div data-e="card" className="relative overflow-hidden" style={{ width: U(260), height: U(400), borderRadius: U(18), background: "var(--rc-accent)", color: "var(--rc-on-accent)", padding: U(12), border: `${U(6)} solid var(--rc-accent2)` }}>
          <div className="flex justify-between" style={{ fontSize: U(13), fontWeight: 800 }}>
            <span className="truncate">{item?.label}</span><span>★ #1</span>
          </div>
          <Cover src={item?.image} size={224} style={{ marginTop: U(8), borderRadius: U(8), width: U(224), height: U(190), border: `${U(3)} solid var(--rc-on-accent)` }} />
          <p style={{ fontSize: U(12), fontStyle: "italic", marginTop: U(8) }}>{item?.sub}</p>
          <div style={{ marginTop: U(8), display: "grid", gap: U(4) }}>
            {stats.map((s, i) => <div key={i} className="truncate" style={{ fontSize: U(14), fontWeight: 700, padding: `${U(4)} ${U(8)}`, borderRadius: U(6), background: "var(--rc-bg)", color: "var(--rc-fg)" }}>{s}</div>)}
          </div>
          <div data-e="shine" aria-hidden className="pointer-events-none absolute top-0 bottom-0" style={{ left: "-130%", width: "60%", background: "linear-gradient(100deg, transparent, color-mix(in srgb, var(--rc-on-accent) 35%, transparent), transparent)" }} />
        </div>
      </div>
    </Fill>
  );
}
