// Charts: rising bars, equalizer, 24-hour radial clock, calendar heatmap, waveform, timeline with pins.
import { useRef } from "react";
import { MONTHS_SHORT, ymdOf } from "../../days";
import { clamp01, easeBack, easeInOut, easeOut, parts, stagger, U, useEntrance } from "../anim";
import { Fill, Head, listOf, type StyleProps } from "../parts";
import type { SlideData } from "../../slides";

/** Values, labels and the highlighted index of any series-like data. */
function seriesOf(d: SlideData): { values: number[]; labels: string[]; highlight: number; texts: string[] } {
  if (d.shape === "series") return { values: d.values, labels: d.labels, highlight: d.highlight, texts: d.values.map(String) };
  if (d.shape === "calendar") {
    const values = d.days.map((x) => x.value);
    return { values, labels: d.days.map((x) => String(ymdOf(x.day).d)), highlight: values.indexOf(Math.max(...values)), texts: values.map(String) };
  }
  const items = listOf(d).slice(0, 6);
  return { values: items.map((i) => i.value ?? 0), labels: items.map((i) => i.label), highlight: 0, texts: items.map((i) => i.valueText ?? "") };
}

export function RisingBars({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const s = seriesOf(data);
  const max = Math.max(1, ...s.values);
  const horizontal = data.shape === "rank";
  useEntrance(1500, (p) => {
    parts(root.current, "bar").forEach((el, i) => {
      const q = easeBack(stagger(p, i, s.values.length, 0.5)) * (s.values[i] / max);
      if (horizontal) el.style.width = `${Math.max(2, q * 100)}%`;
      else el.style.height = `${Math.max(1, q * 100)}%`;
    });
  });
  if (horizontal)
    return (
      <Fill>
        <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(20) }}>
          <Head slide={slide} />
          <div className="flex flex-1 flex-col justify-center" style={{ gap: U(16) }}>
            {s.labels.map((l, i) => (
              <div key={i}>
                <p className="truncate" style={{ fontSize: U(15), fontWeight: 700 }}>{l}</p>
                <div style={{ height: U(26), marginTop: U(4) }}>
                  <div data-e="bar" className="flex h-full items-center justify-end" style={{ width: `${(s.values[i] / max) * 100}%`, background: i === 0 ? "var(--rc-accent)" : "var(--rc-bg2)", color: i === 0 ? "var(--rc-on-accent)" : "var(--rc-fg)", borderRadius: U(6), paddingRight: U(8), fontSize: U(12), fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden" }}>{s.texts[i]}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Fill>
    );
  const step = Math.ceil(s.labels.length / 12);
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(16) }}>
        <Head slide={slide} />
        <div className="flex flex-1 items-end" style={{ gap: U(s.values.length > 14 ? 2 : 6) }}>
          {s.values.map((v, i) => (
            <div key={i} className="flex h-full flex-1 flex-col justify-end items-center" style={{ minWidth: 0 }}>
              <div data-e="bar" className="w-full" style={{ height: `${(v / max) * 100}%`, background: i === s.highlight ? "var(--rc-accent)" : "var(--rc-bg2)", borderRadius: `${U(4)} ${U(4)} 0 0` }} />
              <span style={{ fontSize: U(10), marginTop: U(4), color: i === s.highlight ? "var(--rc-fg)" : "var(--rc-muted)", fontWeight: i === s.highlight ? 800 : 400, visibility: i % step === 0 || i === s.highlight ? "visible" : "hidden", whiteSpace: "nowrap" }}>{s.labels[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </Fill>
  );
}

/** LED columns lighting up segment by segment, bouncing before they settle. */
export function Equalizer({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const s = seriesOf(data);
  const cols = s.values.length > 12 ? s.values.reduce<number[]>((a, v, i) => ((a[Math.floor(i / Math.ceil(s.values.length / 12))] ??= 0), (a[Math.floor(i / Math.ceil(s.values.length / 12))] += v), a), []) : s.values;
  const labels = s.values.length > 12 ? cols.map((_, i) => s.labels[i * Math.ceil(s.values.length / 12)]) : s.labels;
  const max = Math.max(1, ...cols);
  const SEG = 14;
  useEntrance(1800, (p) => {
    parts(root.current, "col").forEach((col, c) => {
      const target = (cols[c] / max) * SEG;
      // A quick overshoot and back, like a meter.
      const q = stagger(p, c, cols.length, 0.4);
      const level = q >= 1 ? target : target * easeBack(q) + Math.sin(q * Math.PI * 3) * (1 - q) * 3;
      Array.from(col.children).forEach((seg, k) => ((seg as HTMLElement).style.visibility = SEG - k <= Math.round(level) ? "visible" : "hidden"));
    });
  });
  const hi = cols.indexOf(max);
  return (
    <Fill style={{ background: "var(--rc-stage)" }}>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(18) }}>
        <Head slide={slide} />
        <div className="flex flex-1 items-end" style={{ gap: U(5) }}>
          {cols.map((_, c) => (
            <div key={c} className="flex flex-1 flex-col items-center" style={{ minWidth: 0, gap: U(6) }}>
              <div data-e="col" className="flex w-full flex-col" style={{ gap: U(3) }}>
                {[...Array(SEG)].map((_, k) => (
                  <div key={k} style={{ height: U(18), borderRadius: U(3), background: k < 3 ? "var(--rc-accent2)" : c === hi ? "var(--rc-accent)" : "var(--rc-fg)" }} />
                ))}
              </div>
              <span className="w-full truncate text-center" style={{ fontSize: U(10), color: "var(--rc-muted)" }}>{labels[c]}</span>
            </div>
          ))}
        </div>
      </div>
    </Fill>
  );
}

/** 24 spokes around a clock face; a hand sweeps once around, then points at the peak hour. */
export function RadialClock({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const s = seriesOf(data);
  const max = Math.max(1, ...s.values);
  const C = 150, R0 = 46, R1 = 128;
  const angle = (h: number) => (h / 24) * Math.PI * 2 - Math.PI / 2;
  useEntrance(2600, (p) => {
    const sweep = easeInOut(clamp01(p / 0.75)) * 24;
    const settle = easeOut(clamp01((p - 0.75) / 0.25));
    // One full sweep, then from 12 o'clock round to the peak hour.
    const handAt = sweep >= 24 ? s.highlight * settle : sweep;
    const [hand] = parts(root.current, "hand") as unknown as SVGLineElement[];
    if (hand) {
      const a = angle(p >= 1 ? s.highlight : handAt % 24);
      hand.setAttribute("x2", String(C + Math.cos(a) * (R1 + 6)));
      hand.setAttribute("y2", String(C + Math.sin(a) * (R1 + 6)));
    }
    (parts(root.current, "spoke") as unknown as SVGLineElement[]).forEach((el, h) => {
      const on = p >= 1 || h < sweep;
      const r = R0 + (R1 - R0) * (s.values[h] / max) * (on ? 1 : 0);
      el.setAttribute("x2", String(C + Math.cos(angle(h)) * r));
      el.setAttribute("y2", String(C + Math.sin(angle(h)) * r));
    });
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(16) }}>
        <Head slide={slide} />
        <svg aria-hidden viewBox="0 0 300 300" style={{ width: U(316), height: U(316), alignSelf: "center" }}>
          <circle cx={C} cy={C} r={R1 + 14} fill="var(--rc-bg2)" />
          <circle cx={C} cy={C} r={R0 - 6} fill="var(--rc-bg)" />
          {s.values.map((_, h) => {
            const a = angle(h);
            return <line data-e="spoke" key={h} x1={C + Math.cos(a) * R0} y1={C + Math.sin(a) * R0} x2={C + Math.cos(a) * (R0 + (R1 - R0) * (s.values[h] / max))} y2={C + Math.sin(a) * (R0 + (R1 - R0) * (s.values[h] / max))} stroke={h === s.highlight ? "var(--rc-accent)" : "var(--rc-fg)"} strokeWidth={h === s.highlight ? 9 : 6} strokeLinecap="round" />;
          })}
          {[0, 6, 12, 18].map((h) => <text key={h} x={C + Math.cos(angle(h)) * (R0 - 18)} y={C + Math.sin(angle(h)) * (R0 - 18) + 4} textAnchor="middle" fontSize="11" fill="var(--rc-muted)">{h}</text>)}
          <line data-e="hand" x1={C} y1={C} x2={C + Math.cos(angle(s.highlight)) * (R1 + 6)} y2={C + Math.sin(angle(s.highlight)) * (R1 + 6)} stroke="var(--rc-accent2)" strokeWidth="3" strokeLinecap="round" />
          <circle cx={C} cy={C} r="5" fill="var(--rc-accent2)" />
        </svg>
        <p style={{ textAlign: "center", fontSize: U(18), fontWeight: 700 }}>{s.labels[s.highlight]}</p>
      </div>
    </Fill>
  );
}

/** A calendar of the period: one cell per day, darker for more plays. */
export function Heatmap({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const d = data.shape === "calendar" ? data : null;
  const from = d?.from ?? 0, to = d?.to ?? 0;
  const byDay = new Map(d?.days.map((x) => [x.day, x.value]) ?? []);
  const max = Math.max(1, ...byDay.values());
  const lead = (ymdOf(from).weekday + 6) % 7; // weeks start on Monday
  const cells = [...Array(lead).fill(null), ...Array.from({ length: to - from + 1 }, (_, i) => from + i)];
  const year = to - from > 40;
  const cols = year ? Math.ceil(cells.length / 7) : 7;
  const size = year ? Math.min(14, 316 / Math.ceil(cells.length / 7)) : 40;
  useEntrance(1600, (p) => {
    parts(root.current, "cell").forEach((el, i, all) => {
      const q = stagger(p, i, all.length, 0.8);
      el.style.visibility = q > 0 ? "visible" : "hidden";
    });
  });
  const shade = (v: number) => (v <= 0 ? "var(--rc-bg2)" : `color-mix(in srgb, var(--rc-accent) ${Math.round(25 + 75 * (v / max))}%, var(--rc-bg2))`);
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(18) }}>
        <Head slide={slide} />
        <div className="flex flex-1 flex-col justify-center">
          {!year && (
            <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: U(5), marginBottom: U(6) }}>
              {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => <span key={i} style={{ fontSize: U(11), textAlign: "center", color: "var(--rc-muted)" }}>{w}</span>)}
            </div>
          )}
          <div className="grid" style={year ? { gridTemplateRows: "repeat(7, auto)", gridAutoFlow: "column", gap: U(2), justifyContent: "center" } : { gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: U(5) }}>
            {cells.map((day, i) => (
              <div data-e="cell" key={i} title={day === null ? undefined : String(byDay.get(day) ?? 0)} className="flex items-center justify-center"
                style={{ width: year ? U(size) : undefined, height: U(year ? size : 38), borderRadius: U(year ? 2 : 8), background: day === null ? "transparent" : shade(byDay.get(day) ?? 0), outline: day !== null && day === d?.highlight ? `${U(2)} solid var(--rc-fg)` : undefined, fontSize: U(11), color: "var(--rc-fg)" }}>
                {!year && day !== null ? ymdOf(day).d : ""}
              </div>
            ))}
          </div>
          {year && <div className="flex justify-between" style={{ marginTop: U(8), fontSize: U(11), color: "var(--rc-muted)" }}>{[0, 3, 6, 9].map((m) => <span key={m}>{MONTHS_SHORT[m]}</span>)}</div>}
        </div>
      </div>
    </Fill>
  );
}

/** Daily listening as a mirrored waveform, drawn left to right. */
export function Waveform({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  let values: number[];
  if (data.shape === "calendar") {
    const byDay = new Map(data.days.map((x) => [x.day, x.value]));
    values = Array.from({ length: data.to - data.from + 1 }, (_, i) => byDay.get(data.from + i) ?? 0);
  } else values = seriesOf(data).values;
  const max = Math.max(1, ...values);
  const W = 316, H = 260, mid = H / 2;
  const w = W / values.length;
  useEntrance(1800, (p) => {
    const [clip] = parts(root.current, "clip");
    if (clip) clip.style.clipPath = `inset(0 ${(1 - easeInOut(p)) * 100}% 0 0)`;
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(18) }}>
        <Head slide={slide} />
        <div data-e="clip" className="flex flex-1 items-center">
          <svg aria-hidden viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: U(H) }}>
            <line x1="0" x2={W} y1={mid} y2={mid} stroke="var(--rc-muted)" strokeWidth="1" />
            {values.map((v, i) => {
              const h = Math.max(1.5, (v / max) * (mid - 6));
              return <rect key={i} x={i * w + w * 0.15} width={Math.max(1, w * 0.7)} y={mid - h} height={h * 2} rx={Math.min(3, w * 0.35)} fill={v === max ? "var(--rc-accent)" : "var(--rc-fg)"} />;
            })}
          </svg>
        </div>
        {data.shape === "series" && <p style={{ fontSize: U(13), color: "var(--rc-muted)", textAlign: "center" }}>{data.labels[0]} → {data.labels.at(-1)}</p>}
      </div>
    </Fill>
  );
}

/** A line across the card with pins dropping onto it; the peak gets the tallest flag. */
export function Timeline({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const pair = data.shape === "pair" ? data : null;
  const s = pair ? { values: [1, 1], labels: [pair.left.label, pair.right.label], highlight: 1, texts: [pair.left.valueText ?? "", pair.right.valueText ?? ""] } : seriesOf(data);
  const max = Math.max(1, ...s.values);
  const n = s.values.length;
  useEntrance(1900, (p) => {
    const [line] = parts(root.current, "line");
    if (line) line.style.width = `${easeInOut(clamp01(p / 0.5)) * 100}%`;
    parts(root.current, "pin").forEach((el, i) => {
      const q = easeBack(stagger(clamp01((p - 0.25) / 0.75), i, n, 0.6));
      el.style.top = `calc(var(--u) * ${-40 * (1 - q)})`;
      el.style.visibility = q > 0 ? "visible" : "hidden";
    });
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(18) }}>
        <Head slide={slide} />
        <div className="relative flex-1">
          <div className="absolute left-0 right-0" style={{ top: "62%" }}>
            <div data-e="line" style={{ height: U(4), width: "100%", background: "var(--rc-fg)", borderRadius: U(2) }} />
          </div>
          {s.values.map((v, i) => {
            const x = n === 1 ? 50 : 6 + (i / (n - 1)) * 88;
            const h = pair ? 140 : 40 + 170 * (v / max);
            const hi = i === s.highlight;
            return (
              <div key={i} className="absolute" style={{ left: `${x}%`, top: "62%", width: 0 }}>
                <div data-e="pin" className="absolute" style={{ left: 0, top: 0 }}>
                  <div className="absolute" style={{ left: U(-1), bottom: 0, width: U(2), height: U(h), background: hi ? "var(--rc-accent)" : "var(--rc-muted)" }} />
                  <div className="absolute" style={{ left: U(-7), top: U(-7), width: U(14), height: U(14), borderRadius: "50%", background: hi ? "var(--rc-accent)" : "var(--rc-fg)" }} />
                  {(pair || hi || n <= 8) && (
                    <div className="absolute" style={{ bottom: U(h + 4), left: U(pair ? (i ? -150 : -10) : -30), width: U(pair ? 160 : 60), textAlign: pair ? (i ? "right" : "left") : "center", fontSize: U(pair ? 15 : 11), fontWeight: hi ? 800 : 500 }}>
                      <p style={{ overflowWrap: "anywhere" }}>{s.labels[i]}</p>
                      {pair && <p style={{ color: "var(--rc-muted)", fontSize: U(12) }}>{s.texts[i]}</p>}
                    </div>
                  )}
                  {!pair && !(hi || n <= 8) && <span className="absolute" style={{ top: U(12), left: U(-12), fontSize: U(9), color: "var(--rc-muted)" }}>{s.labels[i]}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Fill>
  );
}
