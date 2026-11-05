// A recap game card: a question, 2–4 options (mouse or keys 1–4; "rank" games are tapped in order), then a friendly
// reveal. It holds auto-advance until answered; with animations off the reveal is instant.
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtInt } from "../format";
import { isRight, resultLine, type Game } from "../games";
import { seeded } from "../random";
import { countTo, U, useEntrance } from "./anim";
import { Cover, Fill } from "./parts";

export default function GameCard({ game, seed, onDone }: { game: Game; seed: number; onDone: () => void }) {
  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [answered, setAnswered] = useState(false);
  const r = game.rounds[round];
  const rank = Array.isArray(r.answer);
  const rng = useRef(seeded(seed));
  const [line, setLine] = useState("");

  const pick = (id: string) => {
    if (answered) return;
    if (!rank) {
      setPicked([id]);
      setAnswered(true);
      setLine(resultLine(isRight(r, id), rng.current));
      return;
    }
    if (picked.includes(id)) return;
    const next = [...picked, id];
    setPicked(next);
    if (next.length === (r.answer as string[]).length) {
      setAnswered(true);
      setLine(resultLine(isRight(r, next), rng.current));
    }
  };
  const proceed = () => {
    if (round + 1 < game.rounds.length) {
      setRound(round + 1);
      setPicked([]);
      setAnswered(false);
    } else onDone();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= r.options.length && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        pick(r.options[n - 1].id);
      } else if (e.key === "Enter" && answered && !(e.target as HTMLElement)?.closest?.("button")) {
        e.preventDefault();
        proceed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const reveal = useRef<HTMLSpanElement>(null);
  useEntrance(1200, (p) => {
    if (answered && r.revealValue !== undefined) countTo(reveal.current, r.revealValue, p, fmtInt);
  }, [answered, round]);

  return (
    <Fill style={{ background: "var(--rc-bg2)" }}>
      <div className="absolute inset-0 flex flex-col" style={{ padding: U(22), gap: U(16) }}>
        <div>
          <p style={{ fontSize: U(13), textTransform: "uppercase", letterSpacing: U(2), color: "var(--rc-muted)" }}>
            {game.title}{game.rounds.length > 1 ? ` · ${round + 1} of ${game.rounds.length}` : ""}
          </p>
          <h2 style={{ fontSize: U(26), fontWeight: 800, lineHeight: 1.15, marginTop: U(6) }}>{r.question}</h2>
        </div>
        <div role="group" aria-label={r.question} className="flex flex-1 flex-col justify-center" style={{ gap: U(10) }}>
          {r.options.map((o, i) => {
            const chosen = picked.indexOf(o.id);
            const isAnswer = rank ? (r.answer as string[]).indexOf(o.id) : o.id === r.answer;
            const show = answered && (rank || isAnswer === true || chosen >= 0);
            const good = rank ? (r.answer as string[])[chosen] === o.id : isAnswer === true;
            return (
              <button key={o.id} type="button" onClick={() => pick(o.id)} disabled={answered && !rank}
                aria-pressed={chosen >= 0} aria-label={`${i + 1}: ${o.label}${o.sub ? `, ${o.sub}` : ""}`}
                className="flex items-center text-left"
                style={{ gap: U(12), padding: U(10), borderRadius: U(14), minHeight: U(58), fontFamily: "inherit",
                  background: show ? (good ? "var(--rc-accent)" : "var(--rc-bg)") : chosen >= 0 ? "var(--rc-accent2)" : "var(--rc-bg)",
                  color: show ? (good ? "var(--rc-on-accent)" : "var(--rc-fg)") : chosen >= 0 ? "var(--rc-on-accent2)" : "var(--rc-fg)",
                  outline: show && !good ? `${U(2)} solid var(--rc-muted)` : "none" }}>
                <span style={{ width: U(26), height: U(26), borderRadius: "50%", border: `${U(2)} solid currentColor`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: U(13), fontWeight: 800, flexShrink: 0 }}>
                  {rank && chosen >= 0 ? chosen + 1 : i + 1}
                </span>
                {o.image && <Cover src={o.image} size={40} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate" style={{ fontSize: U(16), fontWeight: 700 }}>{o.label}</span>
                  {o.sub && <span className="block truncate" style={{ fontSize: U(12), opacity: 0.8 }}>{o.sub}</span>}
                </span>
                {show && (good ? <Check aria-hidden style={{ width: U(20), height: U(20) }} /> : <X aria-hidden style={{ width: U(20), height: U(20) }} />)}
              </button>
            );
          })}
        </div>
        <div aria-live="polite" style={{ minHeight: U(96) }}>
          {answered && (
            <>
              <p style={{ fontSize: U(22), fontWeight: 800 }}>{line}</p>
              <p style={{ fontSize: U(15), color: "var(--rc-muted)", marginTop: U(4) }}>
                {r.revealValue !== undefined && <><span ref={reveal} style={{ fontWeight: 800, color: "var(--rc-fg)" }}>{fmtInt(r.revealValue)}</span> hours. </>}
                {r.reveal}
              </p>
              <button type="button" onClick={proceed} autoFocus className="m3-btn"
                style={{ marginTop: U(10), padding: `${U(8)} ${U(18)}`, borderRadius: U(99), background: "var(--rc-fg)", color: "var(--rc-bg)", fontSize: U(14), fontWeight: 700 }}>
                {round + 1 < game.rounds.length ? "Next round" : "Continue"}
              </button>
            </>
          )}
          {!answered && <p style={{ fontSize: U(13), color: "var(--rc-muted)" }}>{rank ? "Tap them in order." : `Press 1–${r.options.length} or click.`}</p>}
        </div>
      </div>
    </Fill>
  );
}
