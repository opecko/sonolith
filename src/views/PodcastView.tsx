import { Bookmark, BookmarkCheck, ChevronDown, Play, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ShowChip } from "../api/podcast";
import type { Page, Track } from "../api/types";
import { getEpisodes, getPodcastShow, setPodcastSaved } from "../api/ytm";
import { EpisodeRow } from "../components/Episode";
import LoadMore from "../components/LoadMore";
import { EmptyState, ErrorBox, Loading } from "../components/Status";
import Thumb from "../components/Thumb";
import { useAsync, usePaged } from "../hooks/useData";
import { useNav } from "../stores/nav";
import { playEpisode } from "../stores/actions";
import { useToast } from "../stores/toast";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "Latest ▾" sort dropdown (Latest / Oldest / Popular / Creator provided). */
function SortChip({ chip, active, onPick }: { chip: ShowChip; active: string | null; onPick: (token: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const current = chip.options!.find((o) => o.token === active) ?? chip.options!.find((o) => o.selected) ?? chip.options![0];
  return (
    <div ref={ref} className="relative">
      <button className="chip inline-flex items-center gap-1" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {current.label} <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-10 z-30 w-48 rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] py-2 shadow-2xl">
          {chip.options!.map((o) => (
            <button key={o.token} role="menuitemradio" aria-checked={o === current} onClick={() => { setOpen(false); onPick(o.token); }}
              className={`w-full px-4 py-2 text-left text-sm hover:bg-[var(--c-hover)] ${o === current ? "font-medium" : "text-[var(--c-text-muted)]"}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PodcastView({ id }: { id: string }) {
  const show = useAsync(`podcast:${id}`, () => getPodcastShow(id));
  const [token, setToken] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [more, setMore] = useState(false);
  const s = show.data;
  const first = async (): Promise<Page<Track>> =>
    token ? getEpisodes(token) : { items: s!.episodes, loadMore: s!.next ? () => getEpisodes(s!.next!) : null };
  const eps = usePaged<Track>(s ? `podcast:${id}:${token ?? ""}` : null, first);

  if (show.error) return <ErrorBox error={show.error} onRetry={show.reload} />;
  if (!s) return <Loading variant="list" />;
  const isSaved = saved ?? s.saved;
  // Episodes from this page know their show (the player continues with the show's next episode, shows its name).
  const ofShow = (t: Track): Track => (t.show ? t : { ...t, show: { id, title: s.title } });
  const play = (t: Track) => playEpisode(ofShow(t));
  // The page lists the newest first.
  const newest = s.episodes[0];

  const toggleSave = () => {
    if (!s.playlistId) return;
    setSaved(!isSaved);
    setPodcastSaved(s.playlistId, !isSaved).catch((e) => {
      setSaved(isSaved);
      useToast.getState().show(`Could not update library: ${errMsg(e)}`);
    });
  };
  const share = () =>
    navigator.clipboard?.writeText(`https://music.youtube.com/playlist?list=${id}`).then(
      () => useToast.getState().show("Link copied to clipboard", "info"),
      () => useToast.getState().show("Could not copy the link"),
    );

  return (
    <div className="flex gap-12 max-lg:flex-col max-lg:gap-6">
      <aside className="sticky top-0 flex w-[320px] shrink-0 flex-col items-center self-start text-center max-lg:static max-lg:w-full">
        {s.channel && (
          <button onClick={() => useNav.getState().go({ name: "channel", id: s.channel!.id })}
            className="mb-4 flex max-w-full items-center gap-2 text-sm text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:underline">
            {s.channel.thumbnail && <Thumb src={s.channel.thumbnail} round className="h-5 w-5 shrink-0" />}
            <span className="truncate">{s.channel.name}</span>
          </button>
        )}
        <Thumb src={s.thumbnail} className="aspect-square w-[272px] shadow-2xl" />
        <h1 className="mt-6 text-3xl font-bold tracking-tight">{s.title}</h1>
        {s.description && (
          <>
            <p className={`mt-3 select-text whitespace-pre-line text-sm text-[var(--c-text-muted)] ${more ? "" : "line-clamp-4"}`}>{s.description}</p>
            <button className="mt-1 text-sm font-medium hover:underline" aria-expanded={more} onClick={() => setMore((m) => !m)}>{more ? "Less" : "More"}</button>
          </>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {newest && (
            <button className="m3-btn m3-filled flex h-10 items-center gap-2 rounded-full bg-button px-5 text-sm font-medium text-on-button" onClick={() => play(newest)} title={`Play the latest episode: ${newest.title}`}>
              <Play size={18} fill="currentColor" aria-hidden /> Play latest
            </button>
          )}
          <button className="icon-btn h-10 w-10 bg-[var(--c-hover)]" onClick={() => void share()} aria-label="Share"><Share2 size={20} /></button>
          {s.playlistId && (
            <button onClick={toggleSave} aria-pressed={isSaved}
              className="flex h-10 items-center gap-2 rounded-full bg-[var(--c-hover)] px-4 text-sm font-medium hover:bg-[var(--c-active)]">
              {isSaved ? <BookmarkCheck size={20} aria-hidden /> : <Bookmark size={20} aria-hidden />}
              {isSaved ? "Saved to library" : "Save to library"}
            </button>
          )}
        </div>
      </aside>
      <section className="min-w-0 flex-1">
        <div className="mb-2 flex flex-wrap gap-2" role="toolbar" aria-label="Episode filters">
          {s.chips.map((c) =>
            c.options ? (
              <SortChip key={c.label} chip={c} active={filter ? null : token} onPick={(t) => { setFilter(null); setToken(t); }} />
            ) : (
              <button key={c.label} className="chip" aria-pressed={filter === c.label}
                onClick={() => { const on = filter !== c.label; setFilter(on ? c.label : null); setToken(on ? c.token! : null); }}>
                {c.label}
              </button>
            ),
          )}
        </div>
        {eps.error && !eps.items ? <ErrorBox error={eps.error} onRetry={eps.reload} /> : eps.loading || !eps.items ? <Loading variant="list" /> : (
          <>
            {eps.items.length === 0 && <EmptyState title="No episodes" detail={filter ? `Nothing in "${filter}".` : undefined} />}
            <ol>{eps.items.map((t, i) => <EpisodeRow key={`${t.id}:${i}`} track={t} onPlay={() => play(t)} />)}</ol>
            <LoadMore active={eps.hasMore && !eps.error} loading={eps.loadingMore} onVisible={eps.loadMore} />
          </>
        )}
      </section>
    </div>
  );
}
