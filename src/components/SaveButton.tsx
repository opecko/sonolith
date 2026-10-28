import { ListCheck, ListPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Track } from "../api/types";
import { useAuth } from "../stores/auth";
import { useLibrary } from "../stores/library";
import { openSettings } from "../stores/nav";
import { usePlaylistMembers, watchPlaylist } from "../stores/playlistMembers";
import { saveBehavior } from "../stores/saveButton";
import { useSettings } from "../stores/settings";
import { useToast } from "../stores/toast";
import { useUi } from "../stores/ui";
import { playlistEntries, removeFromPlaylistAction, saveToPlaylist } from "./ItemMenu";
import Menu from "./Menu";

/** How long the picker's button shows its check after a save. */
const SAVED_FLASH_MS = 2000;

/**
 * Now Playing's Save button, so saving a song doesn't go through the ⋮ menu. What a click does is a setting
 * (stores/saveButton.ts): the playlist picker (the icon turns into a check for a moment after a save), straight into
 * one chosen playlist (pressed while the song is in it, like Like; a click on a pressed button takes it out again),
 * or no button at all.
 */
export default function SaveButton({ track, className = "h-10 w-10" }: { track: Track; className?: string }) {
  const settings = useSettings((s) => s.saveButton);
  const signedIn = useAuth((s) => s.status === "signedIn");
  const library = useLibrary((s) => s.playlists);
  const b = saveBehavior(settings, signedIn, library);
  const directId = b.kind === "direct" ? b.id : null;
  const inPlaylist = usePlaylistMembers((s) => !!directId && s.playlistId === directId && !!s.ids?.has(track.id));
  const [flash, setFlash] = useState(false);
  const busy = useRef(false);
  // The picker and the chosen playlist's current title both come from the library.
  useEffect(() => {
    if (signedIn && settings.action !== "off" && !useLibrary.getState().playlists) void useLibrary.getState().load();
  }, [signedIn, settings.action]);
  useEffect(() => {
    if (directId) void watchPlaylist(directId);
  }, [directId]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), SAVED_FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);
  // A new song starts unchecked.
  useEffect(() => setFlash(false), [track.id]);

  if (b.kind === "hidden") return null;
  const icon = flash || inPlaylist ? <ListCheck size={20} /> : <ListPlus size={20} />;
  // Pressed: the M3 style colors it; Classic gets the accent.
  const pressed = flash || inPlaylist ? "text-[var(--c-accent)]" : "";
  if (b.kind === "picker")
    return (
      <Menu label={flash ? "Saved" : "Save to playlist"} className={`icon-btn shrink-0 ${pressed} ${className}`} trigger={icon}
        entries={() => playlistEntries(track, () => setFlash(true))} />
    );
  const title = b.kind === "direct" ? (inPlaylist ? `Remove from "${b.title}"` : `Save to "${b.title}"`) : "Save to playlist";
  return (
    <button className={`icon-btn shrink-0 ${pressed} ${className}`} aria-label={title} title={title}
      aria-pressed={b.kind === "direct" ? inPlaylist : undefined}
      onClick={() => {
        if (b.kind !== "direct") {
          useToast.getState().show("Choose the playlist the Save button saves to.");
          useUi.getState().setNowPlaying(false);
          return openSettings("nowplaying", "saveButton");
        }
        if (busy.current) return;
        busy.current = true;
        const done = () => (busy.current = false);
        void (inPlaylist ? removeFromPlaylistAction(track, b.id) : saveToPlaylist(track, b)).then(done, done);
      }}>
      {icon}
    </button>
  );
}
