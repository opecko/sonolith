// Number-led styles and printed looks: giant number, odometer, receipt, terminal, newspaper, scratch card, poster,
// stack of numerals, marquee rows.
import { useEffect, useRef, useState } from "react";
import { fmtInt } from "../../format";
import { clamp01, countTo, easeBack, easeOut, parts, stagger, U, useEntrance, useLoop } from "../anim";
import { bigText, Cover, Fill, fitSize, Head, listOf, MONO, SERIF, smallText, type StyleProps } from "../parts";

/** Digits of a display string with its number, for count-ups ("1,234" → 1234). */
const numeric = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;
const formatLike = (display: string) => (n: number) => (display.includes(".") ? n.toFixed(1) : fmtInt(n));

export function GiantNumber({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const d = data.shape === "number" ? data : null;
  const display = d?.display ?? bigText(data);
  useEntrance(1600, (p) => {
    const [num] = parts(root.current, "num");
    const [unit] = parts(root.current, "unit");
    if (d) countTo(num, numeric(display), clamp01(p / 0.75), formatLike(display));
    if (num) num.style.fontWeight = String(Math.round(200 + 700 * easeOut(clamp01(p / 0.8))));
    // The unit morphs from airy and wide to tight.
    if (unit) {
      const q = easeOut(clamp01((p - 0.35) / 0.65));
      unit.style.letterSpacing = `calc(var(--u) * ${(1 - q) * 14})`;
      unit.style.opacity = String(q);
    }
    for (const [i, el] of parts(root.current, "fade").entries()) el.style.opacity = String(stagger(p, i, 2, 0.4));
  });
  const size = fitSize(display, 170, 330, 0.6);
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col justify-between" style={{ padding: U(28) }}>
        <Head slide={slide} />
        <div>
          <div data-e="num" aria-hidden style={{ fontSize: U(size), lineHeight: 0.9, color: "var(--rc-accent)", fontVariantNumeric: "tabular-nums", letterSpacing: U(-4), whiteSpace: "nowrap" }}>{display}</div>
          <div data-e="unit" style={{ fontSize: U(30), fontWeight: 300, textTransform: "uppercase", marginTop: U(6), whiteSpace: "nowrap" }}>{d?.unit ?? smallText(data)}</div>
          {d?.caption && <p data-e="fade" style={{ fontSize: U(15), color: "var(--rc-muted)", marginTop: U(14) }}>{d.caption}</p>}
        </div>
      </div>
    </Fill>
  );
}

export function Odometer({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const display = data.shape === "number" ? data.display : bigText(data);
  const chars = [...display];
  const digitH = 74;
  useEntrance(2200, (p) => {
    const strips = parts(root.current, "strip");
    strips.forEach((el, i) => {
      const digit = Number(el.dataset.d);
      // Each wheel spins a few full turns and lands on its digit, the rightmost last.
      const q = easeOut(stagger(p, strips.length - 1 - i, strips.length, 0.45));
      const turns = 2 + (strips.length - 1 - i);
      const pos = (turns * 10 + digit) * q;
      el.style.top = `calc(var(--u) * ${-(pos % 10) * digitH})`;
    });
    for (const el of parts(root.current, "fade")) el.style.opacity = String(clamp01((p - 0.6) / 0.4));
  });
  const w = Math.min(46, 300 / chars.length);
  return (
    <Fill style={{ background: "var(--rc-bg2)" }}>
      <div ref={root} className="absolute inset-0 flex flex-col items-center justify-center" style={{ padding: U(24), gap: U(30) }}>
        <Head slide={slide} style={{ textAlign: "center" }} />
        <div aria-hidden className="flex" style={{ gap: U(4), padding: U(10), borderRadius: U(14), background: "var(--rc-bg)", boxShadow: `inset 0 0 0 ${U(2)} var(--rc-accent)` }}>
          {chars.map((c, i) =>
            /\d/.test(c) ? (
              <div key={i} className="relative overflow-hidden" style={{ width: U(w), height: U(digitH), borderRadius: U(6), background: "var(--rc-accent)", color: "var(--rc-on-accent)" }}>
                <div data-e="strip" data-d={c} className="absolute left-0 right-0" style={{ top: U(-Number(c) * digitH) }}>
                  {[...Array(11)].map((_, k) => (
                    <div key={k} className="flex items-center justify-center" style={{ height: U(digitH), fontSize: U(w * 1.25), fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{k % 10}</div>
                  ))}
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-end justify-center" style={{ width: U(w * 0.45), height: U(digitH), fontSize: U(w), fontWeight: 800 }}>{c}</div>
            ),
          )}
        </div>
        <p data-e="fade" style={{ fontSize: U(20), fontWeight: 600, textAlign: "center" }}>{smallText(data)}</p>
      </div>
    </Fill>
  );
}

/** A till receipt printing line by line. */
export function Receipt({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const rows: [string, string][] =
    data.shape === "number" ? [[data.unit.toUpperCase(), data.display], ...(data.caption ? [[data.caption, ""] as [string, string]] : [])]
    : data.shape === "pair" ? [[data.left.label, data.left.valueText ?? ""], [data.right.label, data.right.valueText ?? ""], ...(data.verdict ? [["CHANGE", data.verdict] as [string, string]] : [])]
    : listOf(data).slice(0, 6).map((it, i) => [`${i + 1}  ${it.label}`, it.valueText ?? ""]);
  useEntrance(400 + rows.length * 380, (p) => {
    const [paper] = parts(root.current, "paper");
    const lines = parts(root.current, "line");
    // The paper grows as lines print; each line appears when the paper reaches it.
    if (paper) paper.style.clipPath = `inset(0 0 ${(1 - easeOut(p)) * 100}% 0)`;
    lines.forEach((el, i) => (el.style.visibility = p >= (i + 0.5) / (lines.length + 1) || p >= 1 ? "visible" : "hidden"));
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(24), gap: U(18) }}>
        <Head slide={slide} />
        <div data-e="paper" className="mx-auto" style={{ width: U(280), background: "var(--rc-fg)", color: "var(--rc-bg)", fontFamily: MONO, padding: `${U(18)} ${U(16)} ${U(26)}`, clipPath: "inset(0 0 0 0)", borderBottom: `${U(4)} dashed var(--rc-bg)` }}>
          <p data-e="line" style={{ textAlign: "center", fontSize: U(15), fontWeight: 700, letterSpacing: U(3) }}>SONOLITH RECAP</p>
          <p data-e="line" style={{ textAlign: "center", fontSize: U(11), marginBottom: U(10) }}>{"-".repeat(32)}</p>
          {rows.map(([l, r], i) => (
            <div data-e="line" key={i} className="flex justify-between" style={{ fontSize: U(13), lineHeight: 1.5, gap: U(10) }}>
              <span className="truncate">{l}</span>
              <span style={{ flexShrink: 0, fontWeight: 700 }}>{r}</span>
            </div>
          ))}
          <p data-e="line" style={{ textAlign: "center", fontSize: U(11), marginTop: U(10) }}>{"-".repeat(32)}</p>
          <p data-e="line" style={{ textAlign: "center", fontSize: U(12) }}>THANK YOU FOR LISTENING</p>
          <div data-e="line" aria-hidden className="mx-auto flex" style={{ marginTop: U(10), height: U(30), gap: U(2), width: "fit-content" }}>
            {[...slide.headline].slice(0, 28).map((c, i) => <span key={i} style={{ width: U((c.charCodeAt(0) % 3) + 1), background: "currentColor" }} />)}
          </div>
        </div>
      </div>
    </Fill>
  );
}

export function Terminal({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const cmd = `sonolith recap --${slide.kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  const out: string[] =
    data.shape === "number" ? [`> ${data.display} ${data.unit}`, ...(data.caption ? [`  ${data.caption}`] : [])]
    : data.shape === "text" ? [`> ${data.big}`, ...data.lines.map((l) => `  ${l}`)]
    : listOf(data).slice(0, 5).map((it, i) => `${String(i + 1).padStart(2)}  ${it.label}${it.valueText ? `  (${it.valueText})` : ""}`);
  const all = cmd.length + out.join("").length;
  useEntrance(600 + all * 22, (p) => {
    const [c] = parts(root.current, "cmd");
    const chars = Math.round(p * all);
    if (c) c.textContent = cmd.slice(0, Math.min(cmd.length, chars));
    let left = chars - cmd.length;
    for (const [i, el] of parts(root.current, "out").entries()) {
      el.textContent = p >= 1 ? out[i] : left > 0 ? out[i].slice(0, left) : "";
      left -= out[i].length;
    }
    for (const el of parts(root.current, "caret")) el.style.visibility = p >= 1 ? "hidden" : "visible";
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(18) }}>
        <Head slide={slide} />
        <div className="flex-1 overflow-hidden" style={{ background: "var(--rc-bg2)", borderRadius: U(12), fontFamily: MONO, fontSize: U(13), lineHeight: 1.6 }}>
          <div className="flex" style={{ gap: U(6), padding: U(10), borderBottom: `${U(1)} solid var(--rc-muted)` }} aria-hidden>
            {[0, 1, 2].map((i) => <span key={i} style={{ width: U(10), height: U(10), borderRadius: "50%", background: i === 0 ? "var(--rc-accent)" : i === 1 ? "var(--rc-accent2)" : "var(--rc-muted)" }} />)}
          </div>
          <div style={{ padding: U(14) }}>
            <p style={{ color: "var(--rc-accent)" }}>$ <span data-e="cmd">{cmd}</span><span data-e="caret">▌</span></p>
            {out.map((o, i) => <p data-e="out" key={i} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontWeight: i === 0 ? 700 : 400 }}>{o}</p>)}
          </div>
        </div>
      </div>
    </Fill>
  );
}

export function Newspaper({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const item = data.shape === "hero" ? data.item : null;
  useEntrance(1300, (p) => {
    const [page] = parts(root.current, "page");
    const q = easeBack(p);
    // The front page spins in from far away.
    if (page) page.style.transform = p >= 1 ? "none" : `rotate(${(1 - q) * 540}deg) scale(${Math.max(0.02, q)})`;
  });
  const big = bigText(data);
  return (
    <Fill style={{ background: "var(--rc-stage)" }}>
      <div ref={root} className="absolute inset-0 flex items-center justify-center">
        <div data-e="page" className="flex flex-col" style={{ width: U(320), height: U(560), background: "var(--rc-fg)", color: "var(--rc-bg)", fontFamily: SERIF, padding: U(16), gap: U(10) }}>
          <div style={{ borderBottom: `${U(3)} double currentColor`, textAlign: "center", paddingBottom: U(6) }}>
            <p style={{ fontSize: U(26), fontWeight: 900, letterSpacing: U(-0.5) }}>The Listening Post</p>
            <p style={{ fontSize: U(10), textTransform: "uppercase", letterSpacing: U(2) }}>Recap edition · Late final</p>
          </div>
          <p style={{ fontSize: U(fitSize(slide.headline, 34, 290, 0.5)), fontWeight: 900, lineHeight: 1.02 }}>{slide.headline}</p>
          {item?.image ? <Cover src={item.image} size={288} style={{ borderRadius: 0, height: U(200), width: "100%", filter: "grayscale(1) contrast(1.15)" }} /> : <p style={{ fontSize: U(fitSize(big, 96, 290, 0.6)), fontWeight: 900, lineHeight: 1, textAlign: "center" }}>{big}</p>}
          <div className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: "1fr 1fr", gap: U(12), fontSize: U(11.5), lineHeight: 1.4, textAlign: "justify" }}>
            <p><b>{item ? item.label : big}</b> {item ? `${item.sub ?? ""}. ${data.shape === "hero" ? data.stat ?? "" : ""}` : smallText(data)}. {slide.aria}</p>
            <p>{slide.sub ?? "Sources close to the listener confirm the news, computed on this very computer."} Full story inside.</p>
          </div>
        </div>
      </div>
    </Fill>
  );
}

/** Scratch to reveal (pointer); a click reveals it all. Holds auto-advance until revealed. */
export function Scratch({ slide, data, hold }: StyleProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [done, setDone] = useState(false);
  const scratched = useRef(0);
  useEffect(() => {
    hold(!done);
    return () => hold(false);
  }, [done]);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    c.width = c.clientWidth;
    c.height = c.clientHeight;
    ctx.fillStyle = getComputedStyle(c).color;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = "destination-out";
  }, []);
  const scratch = (x: number, y: number) => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || done) return;
    const r = c.getBoundingClientRect();
    ctx.beginPath();
    ctx.arc(((x - r.left) / r.width) * c.width, ((y - r.top) / r.height) * c.height, c.width * 0.08, 0, Math.PI * 2);
    ctx.fill();
    // About 40 strokes uncover enough.
    if (++scratched.current > 40) setDone(true);
  };
  const item = data.shape === "hero" ? data.item : null;
  return (
    <Fill>
      <div className="absolute inset-0 flex flex-col" style={{ padding: U(26), gap: U(22) }}>
        <Head slide={slide} />
        <div className="relative mx-auto flex flex-col items-center justify-center" style={{ width: U(300), height: U(330), borderRadius: U(24), background: "var(--rc-accent)", color: "var(--rc-on-accent)", padding: U(18), textAlign: "center", gap: U(12) }}>
          {item?.image && <Cover src={item.image} size={150} />}
          <p style={{ fontSize: U(fitSize(bigText(data), 44, 260, 0.6)), fontWeight: 800, lineHeight: 1.05 }}>{bigText(data)}</p>
          <p style={{ fontSize: U(15) }}>{smallText(data)}</p>
          {!done && (
            <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full" style={{ borderRadius: U(24), color: "var(--rc-bg2)", cursor: "grab", touchAction: "none" }}
              onPointerMove={(e) => e.buttons && scratch(e.clientX, e.clientY)} onPointerDown={(e) => scratch(e.clientX, e.clientY)} />
          )}
        </div>
        {!done && (
          <button type="button" className="mx-auto" onClick={() => setDone(true)} style={{ fontSize: U(14), padding: `${U(8)} ${U(16)}`, borderRadius: U(99), background: "var(--rc-bg2)", color: "var(--rc-fg)" }}>
            Scratch the card, or click to reveal
          </button>
        )}
      </div>
    </Fill>
  );
}

/** Full-bleed poster: the cover (or a color field) wipes in, huge type on top. */
export function Poster({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const image = data.shape === "hero" ? data.item.image : undefined;
  const big = bigText(data);
  useEntrance(1500, (p) => {
    const [img] = parts(root.current, "img");
    const [type] = parts(root.current, "type");
    if (img) img.style.clipPath = `inset(${(1 - easeOut(clamp01(p / 0.7))) * 100}% 0 0 0)`;
    if (type) type.style.clipPath = `inset(0 ${(1 - easeOut(clamp01((p - 0.3) / 0.7))) * 100}% 0 0)`;
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0">
        <div data-e="img" className="absolute inset-0" style={{ background: "var(--rc-accent)" }}>
          {image && <Cover src={image} size={360} style={{ width: "100%", height: "100%", borderRadius: 0 }} />}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex flex-col" style={{ padding: U(22), gap: U(8), background: "var(--rc-bg)" }}>
          <p style={{ fontSize: U(13), textTransform: "uppercase", letterSpacing: U(3), color: "var(--rc-muted)" }}>{slide.headline}</p>
          <p data-e="type" style={{ fontSize: U(fitSize(big, 92, 316, 0.55)), fontWeight: 900, lineHeight: 0.92, letterSpacing: U(-2), textTransform: "uppercase", overflowWrap: "anywhere" }}>{big}</p>
          <p style={{ fontSize: U(15) }}>{smallText(data) || slide.sub}</p>
        </div>
      </div>
    </Fill>
  );
}

/** Giant rank numerals stacked down the card, names beside them; a number is stacked digit by digit. */
export function NumeralStack({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const rows = data.shape === "number"
    ? [...data.display].filter((c) => /\d/.test(c)).slice(0, 6).map((c, i, all) => ({ n: c, label: i === all.length - 1 ? data.unit : "", sub: "" }))
    : listOf(data).slice(0, 5).map((it, i) => ({ n: String(i + 1), label: it.label, sub: it.valueText ?? it.sub ?? "" }));
  useEntrance(1400, (p) => {
    parts(root.current, "row").forEach((el, i, all) => {
      const q = easeBack(stagger(p, i, all.length, 0.55));
      el.style.left = `calc(var(--u) * ${(1 - q) * -320})`;
    });
  });
  const h = Math.min(92, 460 / Math.max(1, rows.length));
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(10) }}>
        <Head slide={slide} />
        <div className="flex flex-1 flex-col justify-center">
          {rows.map((r, i) => (
            <div data-e="row" key={i} className="relative flex items-center" style={{ height: U(h), gap: U(12) }}>
              <span aria-hidden style={{ fontSize: U(h * 1.1), fontWeight: 900, lineHeight: 1, width: U(h * 0.75), color: i === 0 ? "var(--rc-accent)" : "transparent", WebkitTextStroke: `${U(2)} var(--rc-accent)` }}>{r.n}</span>
              <div className="min-w-0">
                <p className="truncate" style={{ fontSize: U(Math.min(22, h * 0.3)), fontWeight: 700 }}>{r.label}</p>
                {r.sub && <p className="truncate" style={{ fontSize: U(13), color: "var(--rc-muted)" }}>{r.sub}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Fill>
  );
}

/** Rows of text scrolling sideways in alternating directions; the main line holds still in the middle. */
export function Marquee({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const items = listOf(data).slice(0, 6).map((i) => i.label);
  const lines = data.shape === "number" ? [data.unit, data.display, data.caption ?? data.unit] : data.shape === "text" ? [data.big, ...data.lines] : items;
  const rows = Array.from({ length: 7 }, (_, i) => lines[i % lines.length] ?? "");
  const offsets = useRef(rows.map((_, i) => i * 37));
  useEntrance(900, (p) => {
    for (const [i, el] of parts(root.current, "row").entries()) el.style.opacity = String(stagger(p, i, rows.length, 0.6));
  });
  // Scrolls for the card's time; the engine stops it with animations off or while hidden.
  useLoop((dt) => {
    parts(root.current, "track").forEach((el, i) => {
      if (i === 3) return;
      offsets.current[i] = (offsets.current[i] + dt * (30 + i * 6) * (i % 2 ? 1 : -1)) % 400;
      el.style.transform = `translateX(calc(var(--u) * ${offsets.current[i] - 200}))`;
    });
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col justify-center" style={{ gap: U(6) }}>
        <Head slide={slide} style={{ position: "absolute", top: U(24), left: U(24), right: U(24) }} />
        <div style={{ marginTop: U(70) }}>
          {rows.map((t, i) => (
            <div data-e="row" key={i} className="overflow-hidden whitespace-nowrap" style={{ height: U(62), background: i === 3 ? "var(--rc-accent)" : "transparent", color: i === 3 ? "var(--rc-on-accent)" : i % 2 ? "var(--rc-fg)" : "var(--rc-muted)" }}>
              <div data-e="track" style={{ fontSize: U(46), fontWeight: i === 3 ? 900 : 300, lineHeight: U(62), transform: i === 3 ? "none" : `translateX(calc(var(--u) * ${i * 37 - 200}))`, textAlign: i === 3 ? "center" : "left", textTransform: "uppercase" }}>
                {i === 3 ? t : `${t} · `.repeat(6)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Fill>
  );
}

