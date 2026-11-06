// Conversational and travel looks: chat bubbles with typing, a boarding pass, head to head.
import { Plane } from "lucide-react";
import { useRef } from "react";
import { hash } from "../../random";
import { clamp01, easeBack, easeOut, parts, stagger, U, useEntrance } from "../anim";
import { bigText, Cover, Fill, fitSize, Head, listOf, MONO, smallText, type StyleProps } from "../parts";

/** Messages arrive one by one, each after a few typing dots. */
export function Chat({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const msgs: { me: boolean; text: string; image?: string; big?: boolean }[] = [
    { me: true, text: "So… how did my listening go?" },
    { me: false, text: slide.headline },
    ...(data.shape === "hero" ? [{ me: false, text: data.item.label, image: data.item.image, big: true }, { me: false, text: smallText(data) }]
      : data.shape === "number" ? [{ me: false, text: `${data.display} ${data.unit}`, big: true }, ...(data.caption ? [{ me: false, text: data.caption }] : [])]
      : data.shape === "text" ? [{ me: false, text: data.big, big: true }, ...data.lines.map((text) => ({ me: false, text }))]
      : listOf(data).slice(0, 3).map((i) => ({ me: false, text: i.label }))),
    { me: true, text: "No way." },
  ].filter((m) => m.text);
  useEntrance(700 * msgs.length, (p) => {
    const bubbles = parts(root.current, "msg");
    const dots = parts(root.current, "dots");
    bubbles.forEach((el, i) => {
      const local = p * msgs.length - i;
      // Typing dots for the first 60 % of each message's slot, then the message.
      el.style.display = p >= 1 || local >= 0.6 ? "flex" : "none";
      if (dots[i]) dots[i].style.display = p < 1 && local >= 0 && local < 0.6 ? "flex" : "none";
    });
  });
  return (
    <Fill style={{ background: "var(--rc-bg2)" }}>
      <div ref={root} className="absolute inset-0 flex flex-col justify-end" style={{ padding: U(18), gap: U(8) }}>
        {msgs.map((m, i) => (
          <div key={i} className="flex flex-col" style={{ alignItems: m.me ? "flex-end" : "flex-start" }}>
            <div data-e="dots" className="items-center" style={{ display: "none", gap: U(4), padding: `${U(10)} ${U(14)}`, borderRadius: U(18), background: m.me ? "var(--rc-accent)" : "var(--rc-bg)" }} aria-hidden>
              {[0, 1, 2].map((k) => <span key={k} style={{ width: U(7), height: U(7), borderRadius: "50%", background: m.me ? "var(--rc-on-accent)" : "var(--rc-muted)" }} />)}
            </div>
            <div data-e="msg" className="items-center" style={{ gap: U(10), maxWidth: "85%", padding: `${U(10)} ${U(14)}`, borderRadius: m.me ? `${U(18)} ${U(18)} ${U(4)} ${U(18)}` : `${U(18)} ${U(18)} ${U(18)} ${U(4)}`, background: m.me ? "var(--rc-accent)" : "var(--rc-bg)", color: m.me ? "var(--rc-on-accent)" : "var(--rc-fg)" }}>
              {m.image && <Cover src={m.image} size={64} />}
              <span style={{ fontSize: U(m.big ? fitSize(m.text, 30, 230, 0.58) : 15), fontWeight: m.big ? 800 : 500, lineHeight: 1.2, overflowWrap: "anywhere" }}>{m.text}</span>
            </div>
          </div>
        ))}
      </div>
    </Fill>
  );
}

/** A boarding pass: from one thing to another (a pair), or a trip to the star of the card. */
export function Ticket({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const from = data.shape === "pair" ? data.left : { label: "You", sub: "Departing" };
  const to = data.shape === "pair" ? data.right : data.shape === "hero" ? data.item : { label: bigText(data), sub: smallText(data) };
  const image = data.shape === "hero" ? data.item.image : undefined;
  const code = (s: string) => s.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X");
  const bars = [...Array(46)].map((_, i) => 1 + (hash(`${slide.headline}${i}`) % 3));
  useEntrance(1400, (p) => {
    const [pass] = parts(root.current, "pass");
    const [stub] = parts(root.current, "stub");
    if (pass) pass.style.top = `calc(var(--u) * ${120 + 520 * (1 - easeOut(clamp01(p / 0.7)))})`;
    if (stub) stub.style.transform = `rotate(${(1 - easeBack(clamp01((p - 0.5) / 0.5))) * -12}deg)`;
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0">
        <Head slide={slide} style={{ position: "absolute", top: U(24), left: U(24), right: U(24) }} />
        <div data-e="pass" className="absolute flex flex-col" style={{ left: U(24), right: U(24), top: U(120), background: "var(--rc-fg)", color: "var(--rc-bg)", borderRadius: U(18), overflow: "hidden" }}>
          <div className="flex items-center justify-between" style={{ padding: U(14), background: "var(--rc-accent)", color: "var(--rc-on-accent)", fontSize: U(12), fontWeight: 800, letterSpacing: U(2) }}>
            <span>BOARDING PASS</span><span>SONOLITH AIR</span>
          </div>
          <div className="flex items-center justify-between" style={{ padding: U(16), gap: U(8) }}>
            <div className="min-w-0"><p style={{ fontSize: U(38), fontWeight: 900, fontFamily: MONO }}>{code(from.label)}</p><p className="truncate" style={{ fontSize: U(12) }}>{from.label}</p></div>
            <Plane aria-hidden style={{ width: U(24), height: U(24), flexShrink: 0 }} />
            <div className="min-w-0 text-right"><p style={{ fontSize: U(38), fontWeight: 900, fontFamily: MONO }}>{code(to.label)}</p><p className="truncate" style={{ fontSize: U(12) }}>{to.label}</p></div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: U(10), padding: `0 ${U(16)} ${U(14)}`, fontSize: U(11) }}>
            <div><p style={{ opacity: 0.7 }}>PASSENGER</p><p style={{ fontWeight: 800, fontSize: U(14) }}>You</p></div>
            <div><p style={{ opacity: 0.7 }}>{data.shape === "hero" ? "STATUS" : "TIME"}</p><p className="truncate" style={{ fontWeight: 800, fontSize: U(14) }}>{data.shape === "hero" ? data.stat ?? data.kicker : to.valueText ?? smallText(data)}</p></div>
            <div><p style={{ opacity: 0.7 }}>GATE</p><p style={{ fontWeight: 800, fontSize: U(14) }}>#1</p></div>
            <div><p style={{ opacity: 0.7 }}>SEAT</p><p style={{ fontWeight: 800, fontSize: U(14) }}>Front row</p></div>
          </div>
          <div data-e="stub" className="flex items-center" style={{ borderTop: `${U(3)} dashed var(--rc-bg)`, padding: U(14), gap: U(12), transformOrigin: "left top" }}>
            {image && <Cover src={image} size={70} />}
            <div aria-hidden className="flex flex-1 items-stretch" style={{ height: U(54), gap: U(2) }}>{bars.map((b, i) => <span key={i} style={{ width: U(b), background: "var(--rc-bg)" }} />)}</div>
          </div>
        </div>
      </div>
    </Fill>
  );
}

/** Split screen: two sides slide in, a VS badge and the verdict between them. */
export function Versus({ slide, data }: StyleProps) {
  const root = useRef<HTMLDivElement>(null);
  const pair = data.shape === "pair" ? data : { left: listOf(data)[0] ?? { label: "" }, right: listOf(data)[1] ?? { label: "" }, verdict: undefined };
  useEntrance(1400, (p) => {
    const [l] = parts(root.current, "left");
    const [r] = parts(root.current, "right");
    const q = easeOut(stagger(p, 0, 2, 0.3)), q2 = easeOut(stagger(p, 1, 2, 0.3));
    if (l) l.style.left = `calc(var(--u) * ${-360 * (1 - q)})`;
    if (r) r.style.left = `calc(var(--u) * ${360 * (1 - q2)})`;
    for (const el of parts(root.current, "vs")) el.style.transform = `translate(-50%, -50%) scale(${Math.max(0.01, easeBack(clamp01((p - 0.6) / 0.4)))})`;
  });
  const side = (it: typeof pair.left, right: boolean) => (
    <div className="flex flex-col items-center justify-center text-center" style={{ height: "100%", padding: U(20), gap: U(10) }}>
      {it.image && <Cover src={it.image} size={110} round />}
      <p style={{ fontSize: U(fitSize(it.label, 30, 280, 0.55)), fontWeight: 900, lineHeight: 1.05, overflowWrap: "anywhere" }}>{it.label}</p>
      {it.sub && <p style={{ fontSize: U(13), opacity: 0.8 }}>{it.sub}</p>}
      {it.valueText && <p style={{ fontSize: U(22), fontWeight: 800, color: right ? "var(--rc-on-accent)" : "var(--rc-accent)" }}>{it.valueText}</p>}
    </div>
  );
  return (
    <Fill>
      <div ref={root} className="absolute inset-0">
        <div data-e="left" className="absolute" style={{ left: 0, top: 0, width: U(360), height: U(320), paddingTop: U(70) }}>{side(pair.left, false)}</div>
        <div data-e="right" className="absolute" style={{ left: 0, top: U(320), width: U(360), height: U(320), background: "var(--rc-accent)", color: "var(--rc-on-accent)" }}>{side(pair.right, true)}</div>
        <Head slide={slide} style={{ position: "absolute", top: U(20), left: U(20), right: U(20), textAlign: "center" }} />
        <div data-e="vs" className="absolute flex items-center justify-center" style={{ left: "50%", top: U(320), transform: "translate(-50%, -50%)", width: U(86), height: U(86), borderRadius: "50%", background: "var(--rc-fg)", color: "var(--rc-bg)", fontWeight: 900, fontSize: U(pair.verdict ? 18 : 26), border: `${U(4)} solid var(--rc-bg)` }}>{pair.verdict ?? "VS"}</div>
      </div>
    </Fill>
  );
}
