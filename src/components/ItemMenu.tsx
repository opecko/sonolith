import {
  Bookmark, BookmarkMinus, CircleCheck, CircleDashed, Disc3, History, ListEnd, ListMinus, ListPlus, ListStart, Loader2, Pin, PinOff, Play, Podcast, Radio, Share2, Shuffle,
  Trash2, User, Users,
} from "lucide-react";
import { useState } from "react";
import { errorText } from "../api/errors";
import type { Item, MenuToggle, Track, TrackMenu } from "../api/types";
import { addToPlaylist, getCredits, getTrackMenu, removeFromPlaylist, sendFeedback } from "../api/ytm";
import { invalidate } from "../hooks/useData";
import { playItem, queueCollection } from "../stores/actions";
import { useAuth } from "../stores/auth";
import { markEpisode, useEpisodeProgress } from "../stores/episodeProgress";
import { useLibrary } from "../stores/library";
import { useNav } from "../stores/nav";
import { usePlayer } from "../stores/player";
import { useToast } from "../stores/toast";
import { useUi } from "../stores/ui";
import { confirmAction } from "./ConfirmDialog";
import Menu, { type MenuEntry } from "./Menu";

const S = 18;
const isMix = (item: Item) => item.type === "playlist" && item.id.startsWith("RD");
const errMsg = errorText;

/** Radio source for any item YT Music offers radio on. */
export function radioSource(item: Item) {
  if (item.type === "track") return { type: "song" as const, id: item.id };
  if (item.type === "album") return { type: "album" as const, id: item.id };
  if (item.type === "artist") return { type: "artist" as const, id: item.id };
  return { type: isMix(item) ? ("mix" as const) : ("playlist" as const), id: item.id };
}

/** A playlist's songs changed: its open page refetches and the sidebar's track count catches up. */
function playlistChanged(id: string) {
  invalidate(`playlist:${id}`);
  useLibrary.getState().changed();
}

/** Playlists whose songs the user can't remove here: Liked Music (that's unliking), mixes, episodes for later. */
const editable = (id: string) => id !== "LM" && !id.startsWith("RD") && !id.startsWith("SE");

/**
 * The user's own playlist: listed in their library with a subtitle that's only a track count ("7 tracks").
 * Playlists saved from others show their author ("Someone • 12 tracks"), auto playlists a label instead.
 */
export function ownPlaylist(id: string): Item | undefined {
  if (!editable(id)) return undefined;
  const p = useLibrary.getState().playlists?.find((x) => x.id === id);
  return p && !p.subtitle?.includes("•") && !/^(auto playlist|youtube music)/i.test(p.subtitle ?? "") ? p : undefined;
}

function removeEntry(track: Track, playlistId: string): MenuEntry {
  const title = useLibrary.getState().playlists?.find((p) => p.id === playlistId)?.title ?? "this playlist";
  return {
    label: "Remove from playlist",
    icon: <ListMinus size={S} />,
    onSelect: () => {
      useLibrary.getState().adjustCount(playlistId, -1);
      removeFromPlaylist(playlistId, track.id).then(
        () => {
          useToast.getState().show(`Removed from "${title}"`, "info");
          playlistChanged(playlistId);
        },
        (e) => {
          void useLibrary.getState().load(); // undo the count
          useToast.getState().show(`Could not remove from "${title}": ${errMsg(e)}`);
        },
      );
    },
  };
}

/** Asks, then deletes the user's playlist; leaves its page if that's where the user is. */
async function deletePlaylistAsked(item: Item) {
  const ok = await confirmAction({
    title: "Delete playlist?",
    message: (
      <>
        <p>
          <strong className="font-semibold text-[var(--c-text)]">"{item.title}"</strong>
          {item.subtitle ? ` (${item.subtitle})` : ""} will be permanently deleted from your YouTube Music account, on
          every device.
        </p>
        <p className="mt-2">The songs themselves stay on YouTube Music. This can't be undone.</p>
      </>
    ),
    confirmLabel: "Delete playlist",
    danger: true,
  });
  if (!ok) return;
  try {
    await useLibrary.getState().remove(item.id);
    const nav = useNav.getState();
    if (nav.route.name === "playlist" && nav.route.id === item.id) nav.go({ name: "library" });
    useToast.getState().show(`Deleted "${item.title}"`, "info");
  } catch (e) {
    useToast.getState().show(`Could not delete "${item.title}": ${errMsg(e)}`);
  }
}

export function playlistEntries(track: Track): MenuEntry[] {
  const lib = useLibrary.getState();
  if (!lib.playlists) void lib.load();
  return (lib.playlists ?? [])
    .filter((p) => editable(p.id))
    .map((p) => ({
      label: p.title,
      onSelect: () => {
        useLibrary.getState().adjustCount(p.id, 1);
        addToPlaylist(p.id, track.id).then(
          () => {
            useToast.getState().show(`Saved to "${p.title}"`, "info");
            playlistChanged(p.id);
          },
          (e) => {
            void useLibrary.getState().load(); // undo the count
            useToast.getState().show(`Could not save to "${p.title}": ${errMsg(e)}`);
          },
        );
      },
    }));
}

// Toggles flipped this session (feedback token → done), so a reopened menu shows the opposite action.
const flipped = new Set<string>();

/** The server's "Mark as played" toggle of an episode (CHECK icon), if its menu has one. */
const playedToggle = (menu: TrackMenu | undefined) => menu?.toggles.find((t) => t.icon === "CHECK");

/**
 * Mark as played / unplayed: the local progress (lists, resume) changes at once; the server's toggle, when there
 * is one, is sent along so YouTube Music agrees.
 */
function markEntry(track: Track, menu: TrackMenu | undefined): MenuEntry {
  const local = useEpisodeProgress.getState().entries[track.id];
  const played = local ? local.played : !!track.episode?.progress?.played;
  const server = playedToggle(menu);
  return {
    label: played ? "Mark as unplayed" : "Mark as played",
    icon: played ? <CircleDashed size={S} /> : <CircleCheck size={S} />,
    onSelect: () => {
      markEpisode(track.id, !played, track.durationSec);
      if (server) void sendFeedback(played ? server.toggledToken : server.token).catch(() => {});
    },
  };
}

function toggleEntry(t: MenuToggle): MenuEntry {
  const on = flipped.has(t.token);
  const label = on ? t.toggledLabel : t.label;
  const token = on ? t.toggledToken : t.token;
  const removes = /^(remove|unpin)/i.test(label);
  const icon = /BOOKMARK/.test(t.icon) ? (removes ? <BookmarkMinus size={S} /> : <Bookmark size={S} />)
    : /KEEP/.test(t.icon) ? (removes ? <PinOff size={S} /> : <Pin size={S} />)
    : <ListPlus size={S} />;
  return {
    label,
    icon,
    onSelect: () =>
      sendFeedback(token).then(
        () => {
          if (on) flipped.delete(t.token);
          else flipped.add(t.token);
          useToast.getState().show(`${label}: done`, "info");
        },
        (e) => useToast.getState().show(`${label} failed: ${errMsg(e)}`),
      ),
  };
}

function openCredits(id: string) {
  const ui = useUi.getState();
  ui.setCredits({ status: "loading" });
  getCredits(id).then(
    (data) => useUi.getState().setCredits({ status: "ok", data }),
    (e) => useUi.getState().setCredits({ status: "error", message: errMsg(e) }),
  );
}

/**
 * Track menu in YouTube Music's order. `menu` = tokens/ids from the list item or fetched via /next on open;
 * `loading` while that fetch runs.
 */
function trackEntries(track: Track, menu: TrackMenu | undefined, loading: boolean, queueIndex?: number, playlistId?: string): MenuEntry[] {
  const p = usePlayer.getState();
  const go = useNav.getState().go;
  const out: MenuEntry[] = [
    // No song radio for podcast episodes.
    ...(track.podcast ? [] : [{ label: "Start radio", icon: <Radio size={S} />, onSelect: () => void p.startRadio(radioSource(track), track.title) }]),
    { label: "Play next", icon: <ListStart size={S} />, onSelect: () => p.playNext(track) },
    { label: "Add to queue", icon: <ListEnd size={S} />, onSelect: () => p.addToQueue(track) },
    // An episode's own "Mark as played" (below) replaces the server's, and also sends it.
    ...(menu?.toggles ?? []).filter((t) => !(track.podcast && t === playedToggle(menu))).map(toggleEntry),
    ...(track.podcast ? [markEntry(track, menu)] : []),
    // Signed out there are no playlists to save to.
    ...(useAuth.getState().status === "signedIn" ? [{ label: "Save to playlist", icon: <ListPlus size={S} />, submenu: () => playlistEntries(track) }] : []),
    // Only on the user's own playlists (saved ones by others are in the library too, but can't be edited).
    ...(playlistId && ownPlaylist(playlistId) ? [removeEntry(track, playlistId)] : []),
  ];
  if (queueIndex !== undefined)
    out.push({ label: "Remove from queue", icon: <Trash2 size={S} />, onSelect: () => p.removeAt(queueIndex), disabled: queueIndex === p.index });
  if (track.show) out.push({ label: "Go to show", icon: <Podcast size={S} />, onSelect: () => go({ name: "podcast", id: track.show!.id }) });
  const albumId = menu?.albumId ?? track.album?.id;
  if (albumId) out.push({ label: "Go to album", icon: <Disc3 size={S} />, onSelect: () => go({ name: "album", id: albumId }) });
  if (menu?.artistId) out.push({ label: "Go to artist", icon: <User size={S} />, onSelect: () => go({ name: "artist", id: menu.artistId! }) });
  if (menu?.creditsId) out.push({ label: "View song credits", icon: <Users size={S} />, onSelect: () => openCredits(menu.creditsId!) });
  out.push({
    label: "Share",
    icon: <Share2 size={S} />,
    onSelect: () =>
      navigator.clipboard?.writeText(`https://music.youtube.com/watch?v=${track.id}`).then(
        () => useToast.getState().show("Link copied to clipboard", "info"),
        () => useToast.getState().show("Could not copy the link"),
      ),
  });
  const hist = menu?.historyRemoveToken;
  if (hist)
    out.push({
      label: "Remove from history",
      icon: <History size={S} />,
      onSelect: () =>
        sendFeedback(hist).then(
          () => useUi.getState().markRemovedHistory(hist),
          (e) => useToast.getState().show(`Could not remove from history: ${errMsg(e)}`),
        ),
    });
  if (menu?.pin) out.push(toggleEntry(menu.pin));
  if (loading) out.push({ label: "Loading more…", icon: <Loader2 size={S} className="animate-spin" />, disabled: true });
  return out;
}

export function itemEntries(item: Item, opts: { queueIndex?: number; menu?: TrackMenu; loading?: boolean; playlistId?: string } = {}): MenuEntry[] {
  if (item.type === "track") return trackEntries(item as Track, opts.menu ?? (item as Track).menu, !!opts.loading, opts.queueIndex, opts.playlistId);
  const p = usePlayer.getState();
  const out: MenuEntry[] = [];
  if (item.type === "album" || item.type === "playlist") {
    out.push(
      { label: "Play", icon: <Play size={S} />, onSelect: () => void playItem(item) },
      { label: "Shuffle play", icon: <Shuffle size={S} />, onSelect: () => void queueCollection(item, "shuffle") },
      { label: "Play next", icon: <ListStart size={S} />, onSelect: () => void queueCollection(item, "next") },
      { label: "Add to queue", icon: <ListEnd size={S} />, onSelect: () => void queueCollection(item, "end") },
    );
  }
  out.push({ label: "Start radio", icon: <Radio size={S} />, onSelect: () => void p.startRadio(radioSource(item), item.title) });
  if (item.type === "playlist" && ownPlaylist(item.id))
    out.push({ label: "Delete playlist", icon: <Trash2 size={S} />, onSelect: () => void deletePlaylistAsked(item) });
  if (item.type === "artist") {
    out.push({ label: "Go to artist", icon: <User size={S} />, onSelect: () => useNav.getState().go({ name: "artist", id: item.id }) });
  }
  return out;
}

/** Tracks without server menu data (album/playlist pages) fetch it via /next when the menu opens. */
export function useTrackMenu(item: Item) {
  const [state, setState] = useState<{ menu?: TrackMenu; loading: boolean }>({ loading: false });
  const load = () => {
    if (item.type !== "track" || (item as Track).menu || state.menu || state.loading) return;
    setState({ loading: true });
    getTrackMenu(item.id).then(
      (menu) => setState({ menu, loading: false }),
      () => setState({ loading: false }),
    );
  };
  return { ...state, load };
}

export default function ItemMenu({ item, queueIndex, playlistId, className }: { item: Item; queueIndex?: number; playlistId?: string; className?: string }) {
  const { menu, loading, load } = useTrackMenu(item);
  return (
    <Menu
      entries={() => itemEntries(item, { queueIndex, menu, loading, playlistId })}
      onOpen={load}
      label={`More actions for ${item.title}`}
      className={className}
    />
  );
}
