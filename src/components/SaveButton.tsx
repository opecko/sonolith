import { ListPlus } from "lucide-react";
import { useEffect } from "react";
import type { Track } from "../api/types";
import { useAuth } from "../stores/auth";
import { useLibrary } from "../stores/library";
import { openSettings } from "../stores/nav";
import { saveBehavior } from "../stores/saveButton";
import { useSettings } from "../stores/settings";
import { useToast } from "../stores/toast";
import { useUi } from "../stores/ui";
import { playlistEntries, saveToPlaylist } from "./ItemMenu";
import Menu from "./Menu";

/**
 * Now Playing's Save button, so saving a song doesn't go through the ⋮ menu. What a click does is a setting
 * (stores/saveButton.ts): the playlist picker, straight into one chosen playlist, or no button at all.
 */
export default function SaveButton({ track, className = "h-10 w-10" }: { track: Track; className?: string }) {
  const settings = useSettings((s) => s.saveButton);
  const signedIn = useAuth((s) => s.status === "signedIn");
  const library = useLibrary((s) => s.playlists);
  // The picker and the chosen playlist's current title both come from the library.
  useEffect(() => {
    if (signedIn && settings.action !== "off" && !useLibrary.getState().playlists) void useLibrary.getState().load();
  }, [signedIn, settings.action]);
  const b = saveBehavior(settings, signedIn, library);
  if (b.kind === "hidden") return null;
  if (b.kind === "picker")
    return <Menu label="Save to playlist" className={`icon-btn shrink-0 ${className}`} trigger={<ListPlus size={20} />} entries={() => playlistEntries(track)} />;
  const title = b.kind === "direct" ? `Save to "${b.title}"` : "Save to playlist";
  return (
    <button className={`icon-btn shrink-0 ${className}`} aria-label={title} title={title}
      onClick={() => {
        if (b.kind === "direct") return saveToPlaylist(track, b);
        useToast.getState().show("Choose the playlist the Save button saves to.");
        useUi.getState().setNowPlaying(false);
        openSettings("nowplaying", "saveButton");
      }}>
      <ListPlus size={20} />
    </button>
  );
}
