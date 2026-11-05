// The yearly finale poster ("your year at a glance") and the end-of-recap actions: the recap's playlists (Play, Add
// to queue, Save to library / Open playlist), Replay and Close.
import { FolderOpen, ListPlus, Play, RotateCcw, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../stores/auth";
import { fmtInt, minutesOf } from "../format";
import { existingPlaylist, openSavedPlaylist, playRecapPlaylist, queueRecapPlaylist, saveRecapPlaylist } from "../playlistActions";
import { PLAYLIST_KINDS, PLAYLIST_LABEL, selectTracks, type PlaylistKind } from "../playlists";
import type { Snapshot } from "../snapshot";
import { clamp01, easeOut, parts, stagger, U, useEntrance } from "./anim";
import { Cover, Fill } from "./parts";

export function FinalePoster({ snap }: { snap: Snapshot }) {
  const root = useRef<HTMLDivElement>(null);
  const s = snap.stats;
  useEntrance(1800, (p) => {
    parts(root.current, "block").forEach((el, i, all) => {
      const q = easeOut(stagger(p, i, all.length, 0.6));
      el.style.clipPath = `inset(0 ${(1 - q) * 100}% 0 0)`;
    });
    const [n] = parts(root.current, "min");
    if (n) n.textContent = fmtInt(minutesOf(s.listenedMs) * (p >= 1 ? 1 : easeOut(clamp01(p / 0.8))));
  });
  return (
    <Fill>
      <div ref={root} className="absolute inset-0 flex flex-col" style={{ padding: U(20), gap: U(12) }}>
        <div data-e="block" className="flex items-end justify-between">
          <p style={{ fontSize: U(64), fontWeight: 900, lineHeight: 0.85, letterSpacing: U(-3), color: "var(--rc-accent)" }}>{snap.period.kind === "year" ? snap.period.year : ""}</p>
          <p style={{ fontSize: U(12), textAlign: "right", color: "var(--rc-muted)", textTransform: "uppercase", letterSpacing: U(2) }}>Your year<br />at a glance</p>
        </div>
        <div data-e="block" className="flex items-baseline" style={{ gap: U(8), borderTop: `${U(2)} solid var(--rc-fg)`, paddingTop: U(8) }}>
          <span data-e="min" style={{ fontSize: U(40), fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{fmtInt(minutesOf(s.listenedMs))}</span>
          <span style={{ fontSize: U(15) }}>minutes · {fmtInt(s.plays)} plays</span>
        </div>
        <div className="grid flex-1" style={{ gridTemplateColumns: "1fr 1fr", gap: U(12), minHeight: 0 }}>
          {[{ title: "Top artists", list: s.topArtists.map((a) => ({ label: a.name, image: a.thumbnail })) }, { title: "Top songs", list: s.topTracks.map((t) => ({ label: t.title, image: t.thumbnail })) }].map((col) => (
            <div data-e="block" key={col.title} className="min-w-0">
              <p style={{ fontSize: U(12), textTransform: "uppercase", letterSpacing: U(1.5), color: "var(--rc-muted)", marginBottom: U(6) }}>{col.title}</p>
              {col.list.slice(0, 5).map((it, i) => (
                <div key={i} className="flex items-center" style={{ gap: U(6), marginBottom: U(6) }}>
                  {i === 0 ? <Cover src={it.image} size={42} /> : <span style={{ width: U(16), fontSize: U(13), fontWeight: 800, color: "var(--rc-muted)" }}>{i + 1}</span>}
                  <span className="min-w-0 truncate" style={{ fontSize: U(i === 0 ? 15 : 13), fontWeight: i === 0 ? 800 : 500 }}>{it.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div data-e="block" style={{ background: "var(--rc-accent)", color: "var(--rc-on-accent)", borderRadius: U(14), padding: U(12) }}>
          <p style={{ fontSize: U(12), textTransform: "uppercase", letterSpacing: U(1.5) }}>Listening persona</p>
          <p style={{ fontSize: U(22), fontWeight: 900 }}>{s.persona.name}</p>
          <p style={{ fontSize: U(12) }}>{s.persona.line}</p>
        </div>
      </div>
    </Fill>
  );
}

/** Under the last card: playlists, Replay, Close. Ordinary app sizes (not card units), keyboard reachable. */
export function EndActions({ snap, onReplay, onClose }: { snap: Snapshot; onReplay: () => void; onClose: () => void }) {
  const kinds = PLAYLIST_KINDS.filter((k) => selectTracks(k, snap.stats, snap.period).length > 0);
  const [kind, setKind] = useState<PlaylistKind>(kinds[0] ?? "top");
  const [saved, setSaved] = useState<Partial<Record<PlaylistKind, string | null>>>({});
  const [busy, setBusy] = useState(false);
  const signedIn = useAuth((s) => s.status === "signedIn");
  useEffect(() => {
    let live = true;
    for (const k of kinds) void existingPlaylist(snap, k).then((id) => live && setSaved((s) => ({ ...s, [k]: id })));
    return () => {
      live = false;
    };
  }, [snap.id]);
  const btn = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium";
  const tonal = { background: "var(--rc-bg2)", color: "var(--rc-fg)" };
  const id = saved[kind];
  return (
    <div className="flex flex-col items-center gap-2" style={{ color: "var(--rc-fg)" }}>
      {kinds.length > 0 && (
        <>
          <div className="flex flex-wrap justify-center gap-1" role="group" aria-label="Recap playlist">
            {kinds.map((k) => (
              <button key={k} type="button" aria-pressed={k === kind} onClick={() => setKind(k)} className={btn}
                style={k === kind ? { background: "var(--rc-fg)", color: "var(--rc-bg)" } : tonal}>{PLAYLIST_LABEL[k]}</button>
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-1">
            <button type="button" className={btn} style={{ background: "var(--rc-accent)", color: "var(--rc-on-accent)" }} onClick={() => playRecapPlaylist(snap, kind)}><Play size={16} aria-hidden /> Play</button>
            <button type="button" className={btn} style={tonal} onClick={() => queueRecapPlaylist(snap, kind)}><ListPlus size={16} aria-hidden /> Add to queue</button>
            {signedIn && (id ? (
              <button type="button" className={btn} style={tonal} onClick={() => openSavedPlaylist(id)}><FolderOpen size={16} aria-hidden /> Open playlist</button>
            ) : (
              <button type="button" className={btn} style={tonal} disabled={busy} onClick={async () => {
                setBusy(true);
                const made = await saveRecapPlaylist(snap, kind);
                setSaved((s) => ({ ...s, [kind]: made }));
                setBusy(false);
              }}><Save size={16} aria-hidden /> {busy ? "Saving…" : "Save to library"}</button>
            ))}
          </div>
        </>
      )}
      <div className="flex gap-1">
        <button type="button" className={btn} style={tonal} onClick={onReplay}><RotateCcw size={16} aria-hidden /> Replay</button>
        <button type="button" className={btn} style={tonal} onClick={onClose}><X size={16} aria-hidden /> Close</button>
      </div>
    </div>
  );
}
