import { ListPlus, Play, Radio, Shuffle } from "lucide-react";
import { useState } from "react";
import type { CardAction, Chip, Item, Page, SearchGroup, SearchResults, Track } from "../api/types";
import { search } from "../api/ytm";
import ItemMenu, { playlistEntries } from "../components/ItemMenu";
import LoadMore from "../components/LoadMore";
import Menu from "../components/Menu";
import { ItemGrid, ShelfRow } from "../components/Shelves";
import { EmptyState, ErrorBox, Loading } from "../components/Status";
import Thumb from "../components/Thumb";
import TrackList from "../components/TrackList";
import { Byline } from "../components/TrackByline";
import { useAsync, usePaged } from "../hooks/useData";
import { openItem } from "../stores/nav";
import { usePlayer } from "../stores/player";

const GROUP_TITLE: Record<SearchGroup, string> = {
  songs: "Songs", videos: "Videos", albums: "Albums", artists: "Artists",
  playlists: "Playlists", podcasts: "Podcasts", episodes: "Episodes",
};
const isTrack = (i: Item): i is Track & Item => i.type === "track";

function activate(item: Item) {
  if (isTrack(item)) usePlayer.getState().playRadio(item);
  else openItem(item);
}

const pill = "flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium";
const primary = `${pill} m3-btn m3-filled bg-button text-on-button hover:bg-button/90`;
const secondary = `${pill} m3-btn m3-outlined border border-fg/25 hover:bg-fg/10`;

/** Shuffle / Mix (artists) and Play / Save (songs), as on the YouTube Music top-result card. */
function CardButtons({ top, actions }: { top: Item; actions: CardAction[] }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {actions.map((a, i) => {
        const cls = i === 0 ? primary : secondary;
        if (a.kind === "save")
          return isTrack(top) ? (
            <Menu key={a.kind} entries={() => playlistEntries(top)} label={`Save ${top.title} to a playlist`} className={cls}
              trigger={<><ListPlus size={18} aria-hidden /> {a.label}</>} />
          ) : null;
        const run = () => {
          if (a.kind === "play" && isTrack(top)) usePlayer.getState().playRadio(top);
          else if (a.playlistId) void usePlayer.getState().startRadio({ type: "mix", id: a.playlistId, params: a.params }, top.title);
        };
        const icon = a.kind === "shuffle" ? <Shuffle size={18} aria-hidden /> : a.kind === "mix" ? <Radio size={18} aria-hidden /> : <Play size={18} fill="currentColor" aria-hidden />;
        return <button key={a.kind} onClick={run} className={cls}>{icon} {a.label}</button>;
      })}
    </div>
  );
}

function TopResult({ items, actions }: { items: Item[]; actions: CardAction[] }) {
  const [top, ...rest] = items;
  if (!top) return null;
  const round = top.art === "round" || top.type === "artist";
  return (
    <section className="mb-10 flex flex-col overflow-hidden rounded-lg bg-[linear-gradient(110deg,color-mix(in_srgb,var(--c-text)_16%,transparent),color-mix(in_srgb,var(--c-text)_5%,transparent))] md:flex-row" aria-label="Top result">
      <div className="flex min-w-0 flex-1 items-center gap-5 p-5">
        <button onClick={() => activate(top)} aria-label={isTrack(top) ? `Play ${top.title}` : `Open ${top.title}`} className="group relative shrink-0">
          <Thumb src={top.thumbnail} round={round} className="h-28 w-28" />
          {isTrack(top) && (
            <span className="absolute inset-0 flex items-center justify-center rounded-[var(--radius)] bg-scrim/30 group-hover:bg-scrim/50" aria-hidden>
              <Play size={36} fill="currentColor" />
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <button onClick={() => activate(top)} className="block max-w-full truncate text-left text-3xl font-bold tracking-tight hover:underline">{top.title}</button>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-[var(--c-text-muted)]">
            {isTrack(top) && top.explicit && <span className="shrink-0 rounded-sm bg-[var(--c-text-subtle)] px-1 text-[10px] font-bold text-[var(--c-bg)]" aria-label="Explicit">E</span>}
            <span className="truncate">{isTrack(top) ? <Byline track={top} /> : top.subtitle}</span>
          </p>
          {actions.length > 0 && <CardButtons top={top} actions={actions} />}
        </div>
        <ItemMenu item={top} className="self-start" />
      </div>
      {rest.length > 0 && (
        <ul className="flex min-w-0 flex-1 flex-col justify-center border-t border-fg/10 p-2 md:border-l md:border-t-0">
          {rest.slice(0, 3).map((r) => (
            <li key={`${r.type}:${r.id}`} className="group relative flex items-center rounded-[var(--radius)] pr-1 hover:bg-fg/10">
              <div className="flex min-w-0 flex-1 items-center gap-4 p-2">
                <span className="relative shrink-0">
                  <Thumb src={r.thumbnail} round={r.type === "artist"} px={56} className="h-14 w-14" />
                  {isTrack(r) && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-[var(--radius)] bg-scrim/60 opacity-0 group-hover:opacity-100" aria-hidden>
                      <Play size={20} fill="currentColor" />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  {/* Covers the row (row-hit); a track's artist and album names are links above it. */}
                  <button onClick={() => activate(r)} className="row-hit block max-w-full truncate text-left text-base font-medium">{r.title}</button>
                  <span className="row-above block truncate text-sm text-[var(--c-text-muted)]">{isTrack(r) ? <Byline track={r} /> : r.subtitle}</span>
                </span>
              </div>
              <ItemMenu item={r} className="relative opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Overview({ res }: { res: SearchResults }) {
  const empty = !res.top.length && !res.shelves.length && !res.groups.length;
  if (empty) return <EmptyState title="No results" detail={res.messages.join(" ") || "Try a different search."} />;
  return (
    <>
      <TopResult items={res.top} actions={res.topActions} />
      {res.shelves.map((s, i) => (
        <section key={`${s.title}:${i}`} className="mb-8">
          <h2 className="mb-4 text-xl font-bold">{s.title}</h2>
          {s.items.every(isTrack) ? <TrackList tracks={s.items as Track[]} radio /> : <ShelfRow shelf={{ ...s, title: "" }} />}
        </section>
      ))}
      {res.groups.map((g) =>
        g.id === "songs" || g.id === "videos" || g.id === "episodes" ? (
          <section key={g.id} className="mb-8">
            <h2 className="mb-4 text-xl font-bold">{GROUP_TITLE[g.id]}</h2>
            <TrackList tracks={g.items as Track[]} radio />
          </section>
        ) : (
          <ShelfRow key={g.id} shelf={{ title: GROUP_TITLE[g.id], items: g.items, layout: "carousel" }} />
        ),
      )}
    </>
  );
}

function Filtered({ query, chip }: { query: string; chip: Chip }) {
  const params = chip.searchParams!;
  const first = async (): Promise<Page<Item>> => {
    const wrap = (r: SearchResults): Page<Item> => ({
      items: [...r.shelves, ...r.groups].flatMap((s) => s.items),
      loadMore: r.next ? async () => wrap(await search(query, params, r.next!)) : null,
    });
    return wrap(await search(query, params));
  };
  const { items, loading, error, hasMore, loadingMore, loadMore, reload } = usePaged(`search:${query}:${params}`, first);
  if (error && !items) return <ErrorBox error={error} onRetry={reload} />;
  if (loading || !items) return <Loading variant="list" label="Searching" />;
  if (!items.length) return <EmptyState title="No results" detail={`Nothing in "${chip.label}".`} />;
  return (
    <>
      {items.every(isTrack) ? <TrackList tracks={items as Track[]} radio /> : <ItemGrid items={items} />}
      {error && <ErrorBox error={error} onRetry={loadMore} />}
      <LoadMore active={hasMore && !error} loading={loadingMore} onVisible={loadMore} />
    </>
  );
}

export default function SearchView({ query }: { query: string }) {
  const [chip, setChip] = useState<Chip | null>(null);
  const overview = useAsync(`search:${query}`, () => search(query));
  const chips = overview.data?.chips.filter((c) => c.searchParams) ?? [];

  return (
    <div className="mx-auto w-full max-w-[920px]">
      <div className="no-scrollbar -mx-2 mb-6 flex gap-2 overflow-x-auto px-2" role="toolbar" aria-label="Filter results">
        {chips.map((c) => (
          <button key={c.label} className="chip" aria-pressed={chip?.label === c.label} onClick={() => setChip(chip?.label === c.label ? null : c)}>
            {c.label}
          </button>
        ))}
      </div>
      {chip ? (
        <Filtered key={chip.label} query={query} chip={chip} />
      ) : overview.error ? (
        <ErrorBox error={overview.error} onRetry={overview.reload} />
      ) : overview.loading || !overview.data ? (
        <Loading variant="list" label="Searching" />
      ) : (
        <Overview res={overview.data} />
      )}
    </div>
  );
}
