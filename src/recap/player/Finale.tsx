// The yearly finale poster ("your year at a glance") and the end-of-recap actions: the recap's playlists (Play, Add
// to queue, Save to library / Open playlist), Replay and Close.
import { BookmarkPlus, Check, ListPlus, Loader2, Play, RotateCcw, X } from "lucide-react";
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

const KIND_LINE: Record<PlaylistKind, (n: number) => string> = {
  top: (n) => `Your ${n} most played`,
  discoveries: (n) => `${n} songs new to you`,
  onRepeat: (n) => `${n} songs you couldn't stop playing`,
};

/** Four covers in a square, the playlist's face. */
function Mosaic({ images }: { images: (string | undefined)[] }) {
  return (
    <div className="grid h-16 w-16 shrink-0 grid-cols-2 overflow-hidden rounded-xl" style={{ background: "var(--rc-bg2)" }} aria-hidden>
      {[0, 1, 2, 3].map((i) => images[i] ? <img key={i} src={images[i]} alt="" referrerPolicy="no-referrer" draggable={false} className="h-8 w-8 object-cover" /> : <span key={i} />)}
    </div>
  );
}

/** One recap playlist: its covers, what it is, Play first, then queue and save (or open, once saved). */
function PlaylistTile({ snap, kind, signedIn }: { snap: Snapshot; kind: PlaylistKind; signedIn: boolean }) {
  const tracks = selectTracks(kind, snap.stats, snap.period);
  const [saved, setSaved] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "queued">("idle");
  useEffect(() => {
    let live = true;
    if (signedIn) void existingPlaylist(snap, kind).then((id) => live && setSaved(id));
    return () => {
      live = false;
    };
  }, [snap.id, kind, signedIn]);
  const icon = "inline-flex h-9 w-9 items-center justify-center rounded-full";
  const quiet = { background: "var(--rc-bg2)", color: "var(--rc-fg)" };
  return (
    <div className="flex min-w-0 flex-1 basis-56 items-center gap-3 rounded-2xl p-3" style={{ background: "color-mix(in srgb, var(--rc-bg) 88%, transparent)", color: "var(--rc-fg)" }}>
      <Mosaic images={tracks.slice(0, 4).map((t) => t.thumbnail)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{PLAYLIST_LABEL[kind]}</p>
        <p className="truncate text-xs" style={{ color: "var(--rc-muted)" }}>{KIND_LINE[kind](tracks.length)}</p>
        <div className="mt-2 flex items-center gap-1.5">
          <button type="button" onClick={() => playRecapPlaylist(snap, kind)} aria-label={`Play ${PLAYLIST_LABEL[kind]}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium" style={{ background: "var(--rc-accent)", color: "var(--rc-on-accent)" }}>
            <Play size={16} aria-hidden /> Play
          </button>
          <button type="button" className={icon} style={quiet} title="Add to queue" aria-label={`Add ${PLAYLIST_LABEL[kind]} to the queue`}
            onClick={() => { queueRecapPlaylist(snap, kind); setState("queued"); }}>
            {state === "queued" ? <Check size={16} aria-hidden /> : <ListPlus size={16} aria-hidden />}
          </button>
          {signedIn && (saved ? (
            <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm" style={quiet} onClick={() => openSavedPlaylist(saved)} title="Open the saved playlist">
              <Check size={16} aria-hidden /> In library
            </button>
          ) : (
            <button type="button" className={icon} style={quiet} disabled={state === "saving"} title="Save to library as a private playlist" aria-label={`Save ${PLAYLIST_LABEL[kind]} to your library`}
              onClick={async () => {
                setState("saving");
                setSaved(await saveRecapPlaylist(snap, kind));
                setState("idle");
              }}>
              {state === "saving" ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <BookmarkPlus size={16} aria-hidden />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Under the last card: the recap's playlists, Replay and Close. Ordinary app sizes (not card units). */
export function EndActions({ snap, onReplay, onClose }: { snap: Snapshot; onReplay: () => void; onClose: () => void }) {
  const kinds = PLAYLIST_KINDS.filter((k) => selectTracks(k, snap.stats, snap.period).length > 0);
  const signedIn = useAuth((s) => s.status === "signedIn");
  const text = "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium";
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2" style={{ color: "var(--rc-fg)" }}>
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{kinds.length ? "Take your recap with you" : "That's your recap"}</p>
        <button type="button" className={text} onClick={onReplay}><RotateCcw size={16} aria-hidden /> Replay</button>
        <button type="button" className={text} onClick={onClose}><X size={16} aria-hidden /> Close</button>
      </div>
      {kinds.length > 0 && <div className="flex flex-wrap gap-2">{kinds.map((k) => <PlaylistTile key={k} snap={snap} kind={k} signedIn={signedIn} />)}</div>}
      {kinds.length > 0 && !signedIn && <p className="text-xs" style={{ color: "var(--rc-muted)" }}>Sign in to save them to your library.</p>}
    </div>
  );
}
