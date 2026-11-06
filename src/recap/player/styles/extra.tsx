// More looks: split-flap board, polaroids, cassette tape, donut chart, slot machine, magazine cover, medal, weekly
// forecast.
import { Cloud, CloudDrizzle, CloudSun, Heart, Music, Music2, Sparkles, Star, Sun, type LucideIcon } from "lucide-react";
import { useRef } from "react";
import { clamp01, easeBack, easeInOut, easeOut, parts, stagger, U, useEntrance, useLoop } from "../anim";
import { bigText, Cover, Fill, fitSize, Head, jitter, listOf, MONO, rankNo, smallText, type StyleProps } from "../parts";

const FLAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#";

/**
 * Text for a board `width` characters wide: words wrap onto the next row (a word longer than a row is split), and a
 * text that no longer fits in `maxRows` is left out whole rather than cut. In a ranked list each entry is one row.
 */
export function flapLines(texts: string[], width: number, maxRows: number, oneRowEach = false): string[] {
  const rows: string[] = [];
  for (const raw of texts) {
    const t = raw.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const mine: string[] = [];
    if (oneRowEach) mine.push(t.length > width ? `${t.slice(0, width - 1)}…` : t);
    else {
      let row = "";
      for (let word of t.split(" ")) {
        while (word.length > width) {
          if (row) mine.push(row), (row = "");
          mine.push(word.slice(0, width));
          word = word.slice(width);
        }
        if (!word) continue;
        if (!row) row = word;
        else if (row.length + 1 + word.length <= width) row += ` ${word}`;
        else mine.push(row), (row = word);
      }
      if (row) mine.push(row);
    }
    if (rows.length + mine.length > maxRows) break;
    rows.push(...mine);
  }
  return rows.map((r) => r.padEnd(width, " "));
}

/** An airport departures board: every character flips through the alphabet before it lands. */
export function SplitFlap({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const W = 13;
  const lines = flapLines(data.shape === "number" ? [data.display, data.unit, data.caption ?? ""]
    : data.shape === "text" ? [data.big, ...data.lines]
    : listOf(data).slice(0, 5).map((it, i) => `${rankNo(data, i)} ${it.label}`), W, 7, data.shape === "rank");
  useEntrance(2200, (p) => {
    parts(root.current, "ch").forEach((el, i) => {
      const final = el.dataset.c ?? " ";
      const done = stagger(p, i % W + Math.floor(i / W) * 2, W + lines.length * 2, 0.6) >= 1;
      el.textContent = p >= 1 || done || final === " " ? final : FLAP[Math.floor((p * 40 + jitter(i, 9) * FLAP.length)) % FLAP.length];
    });
  });
  return (
    <Fill style={{ background: "var(--rc-stage)" }}>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(18), gap: U(18) }}>
        <Head slide={slide} />
        <div className="flex flex-1 flex-col justify-center" style={{ gap: U(6) }}>
          <p style={{ fontSize: U(11), letterSpacing: U(3), color: "var(--rc-accent)", fontFamily: MONO }}>NOW SHOWING</p>
          {lines.map((l, r) => (
            <div key={r} className="flex" style={{ gap: U(2) }} aria-label={l.trim()}>
              {[...l].map((c, i) => (
                <span data-e="ch" data-c={c} key={i} aria-hidden className="relative flex items-center justify-center"
                  style={{ width: U(24), height: U(36), fontFamily: MONO, fontSize: U(22), fontWeight: 700, borderRadius: U(3), background: "var(--rc-bg2)", color: r === 0 ? "var(--rc-accent)" : "var(--rc-fg)", boxShadow: `inset 0 ${U(-1)} 0 var(--rc-stage)`, backgroundImage: "linear-gradient(transparent 49%, var(--rc-stage) 49%, var(--rc-stage) 51%, transparent 51%)" }}>{c}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Fill>
  );
}

/** Instant photos dropped onto a table. */
export function Polaroids({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const items = data.shape === "hero" ? [data.item] : listOf(data).slice(0, 5);
  const one = items.length === 1;
  const spots = items.map((_, i) => ({ x: one ? 50 : 18 + (i % 2) * 140 + jitter(i, 3) * 30, y: one ? 120 : 110 + i * 85, r: (jitter(i, 5) - 0.5) * (one ? 8 : 22) }));
  useEntrance(1700, (p) => {
    parts(root.current, "photo").forEach((el, i) => {
      const q = easeOut(stagger(p, items.length - 1 - i, items.length, 0.65));
      el.style.top = `calc(var(--u) * ${spots[i].y - 640 * (1 - q)})`;
      el.style.transform = `rotate(${spots[i].r + (1 - q) * 30}deg)`;
    });
  });
  const size = one ? 240 : 140;
  return (
    <Fill style={{ background: "var(--rc-bg2)" }}>
      <div ref={root} className="absolute inset-0">
        <Head slide={slide} style={{ position: "absolute", top: U(22), left: U(22), right: U(22), zIndex: 10 }} />
        {items.map((it, i) => (
          <div data-e="photo" key={i} className="absolute" style={{ left: U(spots[i].x), top: U(spots[i].y), transform: `rotate(${spots[i].r}deg)`, background: "var(--rc-fg)", color: "var(--rc-bg)", padding: `${U(8)} ${U(8)} ${U(one ? 46 : 30)}`, zIndex: items.length - i, boxShadow: `0 ${U(6)} ${U(14)} color-mix(in srgb, var(--rc-stage) 50%, transparent)` }}>
            <Cover src={it.image} size={size} style={{ borderRadius: 0 }} />
            <p className="absolute truncate" style={{ left: U(10), right: U(10), bottom: U(one ? 12 : 6), fontSize: U(one ? 20 : 13), fontWeight: 600, fontStyle: "italic" }}>{one ? it.label : `${rankNo(data, i)}. ${it.label}`}</p>
          </div>
        ))}
        {one && <p className="absolute text-center" style={{ left: U(20), right: U(20), bottom: U(36), fontSize: U(16), color: "var(--rc-muted)" }}>{smallText(data)}</p>}
      </div>
    </Fill>
  );
}

/** A mixtape: the label carries the answer, the reels spin for a few seconds. */
export function Cassette({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const image = data.shape === "hero" ? data.item.image : undefined;
  const label = bigText(data);
  useEntrance(900, (p) => {
    const [tape] = parts(root.current, "tape");
    if (tape) tape.style.top = `calc(var(--u) * ${200 + 300 * (1 - easeBack(p))})`;
  });
  const spin = useRef(0);
  useLoop((dt) => {
    if (spin.current > 4) return;
    spin.current += dt;
    for (const el of parts(root.current, "reel")) el.setAttribute("transform", `rotate(${spin.current * 160} 30 30)`);
  });
  const Reel = () => (
    <svg viewBox="0 0 60 60" style={{ width: U(58), height: U(58) }} aria-hidden>
      <circle cx="30" cy="30" r="28" fill="var(--rc-bg)" />
      <g data-e="reel">{[0, 60, 120, 180, 240, 300].map((a) => <rect key={a} x="28" y="8" width="4" height="12" rx="1" fill="var(--rc-fg)" transform={`rotate(${a} 30 30)`} />)}</g>
      <circle cx="30" cy="30" r="6" fill="var(--rc-fg)" />
    </svg>
  );
  return (
    <Fill>
      <div ref={root} className="absolute inset-0">
        <Head slide={slide} style={{ position: "absolute", top: U(24), left: U(24), right: U(24) }} />
        <div data-e="tape" className="absolute" style={{ left: U(20), right: U(20), top: U(200), height: U(210), borderRadius: U(16), background: "var(--rc-accent)", padding: U(14) }}>
          <div className="flex items-center" style={{ height: U(84), borderRadius: U(8), background: "var(--rc-fg)", color: "var(--rc-bg)", padding: U(10), gap: U(10) }}>
            {image && <Cover src={image} size={62} />}
            <div className="min-w-0">
              <p className="truncate" style={{ fontSize: U(fitSize(label, 24, 200, 0.55)), fontWeight: 800, fontStyle: "italic" }}>{label}</p>
              <p className="truncate" style={{ fontSize: U(12) }}>{smallText(data) || slide.sub}</p>
            </div>
          </div>
          <div className="flex items-center justify-between" style={{ marginTop: U(14), padding: `0 ${U(24)}`, height: U(76), borderRadius: U(40), background: "var(--rc-bg2)" }}>
            <Reel /><span style={{ fontFamily: MONO, fontSize: U(12), color: "var(--rc-fg)" }}>SIDE A</span><Reel />
          </div>
        </div>
      </div>
    </Fill>
  );
}

/** A donut chart drawing itself, with a legend. */
export function Donut({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  let rows = data.shape === "series" ? data.labels.map((label, i) => ({ label, value: data.values[i] })) : listOf(data).slice(0, 5).map((it) => ({ label: it.label, value: it.value ?? 1 }));
  if (rows.length > 6) {
    const sorted = [...rows].sort((a, b) => b.value - a.value);
    rows = [...sorted.slice(0, 5), { label: "Other", value: sorted.slice(5).reduce((a, r) => a + r.value, 0) }];
  }
  const total = Math.max(1, rows.reduce((a, r) => a + r.value, 0));
  const R = 70, C = 2 * Math.PI * R;
  const colors = ["var(--rc-accent)", "var(--rc-accent2)", "var(--rc-fg)", "var(--rc-muted)", "var(--rc-bg)", "var(--rc-stage)"];
  useEntrance(1600, (p) => {
    const q = easeInOut(p);
    (parts(root.current, "seg") as unknown as SVGCircleElement[]).forEach((el) => {
      const len = Number(el.dataset.len);
      el.setAttribute("stroke-dasharray", `${len * q} ${C}`);
    });
  });
  let acc = 0;
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(14) }}>
        <Head slide={slide} />
        <svg viewBox="0 0 200 200" style={{ width: U(220), height: U(220), alignSelf: "center" }} aria-hidden>
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--rc-bg2)" strokeWidth="34" />
          {rows.map((r, i) => {
            const len = (r.value / total) * C;
            const off = acc;
            acc += len;
            return <circle data-e="seg" data-len={len} key={i} cx="100" cy="100" r={R} fill="none" stroke={colors[i % colors.length]} strokeWidth="34" strokeDasharray={`${len} ${C}`} strokeDashoffset={-off} transform="rotate(-90 100 100)" />;
          })}
        </svg>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: `${U(6)} ${U(12)}` }}>
          {rows.map((r, i) => (
            <div key={i} className="flex min-w-0 items-center" style={{ gap: U(6), fontSize: U(13) }}>
              <span style={{ width: U(10), height: U(10), borderRadius: U(3), flexShrink: 0, background: colors[i % colors.length], outline: `${U(1)} solid var(--rc-muted)` }} />
              <span className="truncate">{r.label}</span>
              <span style={{ color: "var(--rc-muted)", marginLeft: "auto" }}>{Math.round((r.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Fill>
  );
}

const REEL: (LucideIcon | string)[] = [Music, Star, Heart, "#1", Music2, Sparkles, Music, Star, Heart, "#1"];

/** One symbol on a slot machine reel. */
function ReelSymbol({ k }: { k: number }) {
  const S = REEL[k % 10];
  return typeof S === "string" ? <>{S}</> : <S aria-hidden style={{ width: U(34), height: U(34) }} />;
}

/** A slot machine: the lever drops, the reels spin and stop one by one on the answer. */
export function SlotMachine({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const image = data.shape === "hero" ? data.item.image : undefined;
  const digits = data.shape === "number" ? [...data.display].filter((c) => /\d/.test(c)).slice(-4) : ["7", "7", "7"];
  const reels = image ? 3 : digits.length;
  const H = 86;
  useEntrance(2400, (p) => {
    const [lever] = parts(root.current, "lever");
    if (lever) lever.style.top = `calc(var(--u) * ${10 + 70 * Math.sin(clamp01(p / 0.2) * Math.PI)})`;
    parts(root.current, "strip").forEach((el, i) => {
      const q = easeOut(clamp01((p - 0.15 - i * 0.18) / 0.5));
      const spins = 3 + i;
      el.style.top = `calc(var(--u) * ${-((1 - q) * spins * 10 % 10) * H})`;
    });
    for (const el of parts(root.current, "win")) el.style.visibility = p >= 0.95 ? "visible" : "hidden";
  });
  return (
    <Fill style={{ background: "var(--rc-stage)" }}>
      <div ref={root} className="absolute inset-0 flex flex-col items-center" style={{ padding: U(22), gap: U(18) }}>
        <Head slide={slide} style={{ textAlign: "center" }} />
        <div className="relative" style={{ width: U(290), padding: U(14), borderRadius: U(22), background: "var(--rc-accent)", marginTop: U(20) }}>
          <div className="flex justify-around" style={{ marginBottom: U(10) }} aria-hidden>
            {[...Array(7)].map((_, i) => <span key={i} style={{ width: U(10), height: U(10), borderRadius: "50%", background: i % 2 ? "var(--rc-fg)" : "var(--rc-accent2)" }} />)}
          </div>
          <div className="flex justify-center" style={{ gap: U(6) }}>
            {[...Array(reels)].map((_, i) => (
              <div key={i} className="relative overflow-hidden" style={{ width: U(image ? 80 : Math.min(80, 240 / reels)), height: U(H), borderRadius: U(10), background: "var(--rc-fg)", color: "var(--rc-bg)" }}>
                <div data-e="strip" className="absolute left-0 right-0" style={{ top: 0 }}>
                  {[...Array(11)].map((_, k) => (
                    <div key={k} className="flex items-center justify-center" style={{ height: U(H), fontSize: U(38), fontWeight: 900 }}>
                      {k % 10 === 0 ? (image ? <Cover src={image} size={66} /> : digits[i]) : <ReelSymbol k={k} />}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div data-e="lever" aria-hidden className="absolute" style={{ right: U(-26), top: U(10), width: U(14), height: U(14), borderRadius: "50%", background: "var(--rc-accent2)" }} />
          <div aria-hidden className="absolute" style={{ right: U(-21), top: U(18), width: U(4), height: U(90), background: "var(--rc-fg)" }} />
        </div>
        <div data-e="win" className="text-center">
          <p style={{ fontSize: U(14), letterSpacing: U(4), color: "var(--rc-accent)", fontWeight: 800 }}>JACKPOT</p>
          <p style={{ fontSize: U(fitSize(bigText(data), 34, 300, 0.58)), fontWeight: 900 }}>{data.shape === "number" ? `${data.display} ${data.unit}` : bigText(data)}</p>
          <p style={{ fontSize: U(14), color: "var(--rc-muted)" }}>{data.shape === "number" ? data.caption : smallText(data)}</p>
        </div>
      </div>
    </Fill>
  );
}

/** A glossy magazine cover with you on it. */
export function Magazine({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const item = data.shape === "hero" ? data.item : listOf(data)[0];
  const masthead = "ENCORE";
  useEntrance(1500, (p) => {
    parts(root.current, "letter").forEach((el, i) => (el.style.top = `calc(var(--u) * ${-120 * (1 - easeBack(stagger(p, i, masthead.length, 0.6)))})`));
    parts(root.current, "line").forEach((el, i) => (el.style.left = `calc(var(--u) * ${-260 * (1 - easeOut(stagger(clamp01((p - 0.35) / 0.65), i, 3, 0.5)))})`));
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0">
        <Cover src={item?.image} size={360} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: 0 }} />
        <div className="absolute inset-x-0 top-0 flex justify-center" style={{ paddingTop: U(10), background: "linear-gradient(var(--rc-bg), transparent)" }}>
          {[...masthead].map((c, i) => <span data-e="letter" key={i} className="relative" style={{ fontSize: U(78), fontWeight: 900, letterSpacing: U(-2), color: "var(--rc-accent)", lineHeight: 1 }}>{c}</span>)}
        </div>
        <div className="absolute inset-x-0 bottom-0 flex flex-col" style={{ padding: U(18), gap: U(6), background: "linear-gradient(transparent, var(--rc-bg) 35%)", paddingTop: U(80) }}>
          <p data-e="line" className="relative" style={{ fontSize: U(13), fontWeight: 800, textTransform: "uppercase", letterSpacing: U(2), color: "var(--rc-accent)" }}>{data.shape === "hero" ? data.kicker ?? "Exclusive" : "Exclusive"}</p>
          <p data-e="line" className="relative" style={{ fontSize: U(fitSize(item?.label ?? "", 44, 320, 0.55)), fontWeight: 900, lineHeight: 1 }}>{item?.label}</p>
          <p data-e="line" className="relative" style={{ fontSize: U(14) }}>{slide.headline} · {smallText(data)}</p>
        </div>
        <div aria-hidden className="absolute flex" style={{ right: U(14), top: U(100), padding: U(6), background: "var(--rc-fg)", gap: U(1), height: U(34) }}>
          {[...Array(18)].map((_, i) => <span key={i} style={{ width: U(1 + (i * 7) % 3), background: "var(--rc-bg)" }} />)}
        </div>
      </div>
    </Fill>
  );
}

/** A medal on a ribbon, swinging until it settles. */
export function Medal({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const image = data.shape === "hero" ? data.item.image : undefined;
  const center = data.shape === "number" ? data.display : "#1";
  useEntrance(2400, (p) => {
    const [m] = parts(root.current, "medal");
    // A damped pendulum.
    const angle = p >= 1 ? 0 : 28 * Math.exp(-4 * p) * Math.cos(p * 18);
    if (m) m.style.transform = `rotate(${angle}deg)`;
  });
  const ring = (data.shape === "hero" ? `${data.kicker ?? slide.headline}` : data.shape === "number" ? data.unit : slide.headline).toUpperCase();
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col items-center" style={{ padding: U(22) }}>
        <div data-e="medal" className="flex flex-col items-center" style={{ transformOrigin: "50% 0" }}>
          <svg viewBox="0 0 120 120" style={{ width: U(130), height: U(130), marginTop: U(-10) }} aria-hidden>
            <polygon points="20,0 55,0 75,120 40,120" fill="var(--rc-accent2)" />
            <polygon points="65,0 100,0 80,120 45,120" fill="var(--rc-accent)" />
          </svg>
          <div className="relative flex items-center justify-center" style={{ width: U(220), height: U(220), borderRadius: "50%", background: "var(--rc-accent)", marginTop: U(-30), boxShadow: `inset 0 0 0 ${U(10)} var(--rc-accent2)` }}>
            <svg viewBox="0 0 220 220" className="absolute inset-0 h-full w-full" aria-hidden>
              <defs><path id="medal-ring" d="M110,110 m-86,0 a86,86 0 1,1 172,0 a86,86 0 1,1 -172,0" /></defs>
              <text fontSize="13" fontWeight="800" letterSpacing="3" fill="var(--rc-on-accent)"><textPath href="#medal-ring">{`${ring} • ${ring} • `.slice(0, 60)}</textPath></text>
            </svg>
            {image ? <Cover src={image} size={130} round /> : <span style={{ fontSize: U(fitSize(center, 64, 140, 0.6)), fontWeight: 900, color: "var(--rc-on-accent)" }}>{center}</span>}
          </div>
        </div>
        <div className="mt-auto text-center">
          <p style={{ fontSize: U(fitSize(bigText(data), 32, 300, 0.56)), fontWeight: 900, lineHeight: 1.05 }}>{data.shape === "number" ? slide.headline : bigText(data)}</p>
          <p style={{ fontSize: U(14), color: "var(--rc-muted)", marginTop: U(6) }}>{smallText(data)}</p>
        </div>
      </div>
    </Fill>
  );
}

/** The week as a weather forecast: the busiest days are sunny. */
export function Forecast({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const values = data.shape === "series" ? data.values : [];
  const labels = data.shape === "series" ? data.labels : [];
  const max = Math.max(1, ...values);
  const Icon = (v: number) => (v / max > 0.8 ? Sun : v / max > 0.5 ? CloudSun : v / max > 0.2 ? Cloud : CloudDrizzle);
  useEntrance(1400, (p) => {
    parts(root.current, "day").forEach((el, i) => {
      const q = easeBack(stagger(p, i, values.length, 0.6));
      el.style.top = `calc(var(--u) * ${40 * (1 - q)})`;
      el.style.visibility = q > 0 ? "visible" : "hidden";
    });
  });
  const hi = values.indexOf(max);
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(14) }}>
        <Head slide={slide} />
        <div style={{ borderRadius: U(18), background: "var(--rc-bg2)", padding: U(16) }}>
          <p style={{ fontSize: U(13), color: "var(--rc-muted)" }}>Listening forecast</p>
          <p style={{ fontSize: U(46), fontWeight: 300 }}>{values[hi] ?? 0}<span style={{ fontSize: U(20) }}> plays</span></p>
          <p style={{ fontSize: U(15), fontWeight: 600 }}>Sunniest on {labels[hi]}</p>
        </div>
        <div className="flex flex-1 items-center justify-between">
          {values.map((v, i) => {
            const I = Icon(v);
            return (
              <div data-e="day" key={i} className="relative flex flex-col items-center" style={{ gap: U(8), padding: `${U(10)} ${U(4)}`, borderRadius: U(14), background: i === hi ? "var(--rc-accent)" : "transparent", color: i === hi ? "var(--rc-on-accent)" : "var(--rc-fg)", width: U(42) }}>
                <span style={{ fontSize: U(12) }}>{labels[i]}</span>
                <I aria-hidden style={{ width: U(24), height: U(24) }} />
                <span style={{ fontSize: U(14), fontWeight: 700 }}>{v}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Fill>
  );
}
