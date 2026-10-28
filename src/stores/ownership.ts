/**
 * Which library playlists are the user's own (they can be saved into, have songs removed, be deleted). YouTube's
 * library listing has no flag for it, only the subtitle: an own playlist shows just its count ("7 tracks"), or, for
 * some accounts (brand channels), its author first, which is then the account itself ("opecko • 0 tracks").
 * Saved playlists show someone else as author, auto playlists a label ("Auto playlist", "YouTube Music").
 */

/** Liked Music (that's liking), mixes and Episodes for Later can't take songs. */
export const editablePlaylist = (id: string) => id !== "LM" && !id.startsWith("RD") && !id.startsWith("SE");

const AUTO = /^(auto playlist|youtube music|your queued episodes)/i;

/** `owners`: the account's name and handle (with or without "@"), as the author may show either. */
export function isOwnPlaylist(p: { id: string; subtitle?: string }, owners: readonly string[]): boolean {
  if (!editablePlaylist(p.id)) return false;
  const subtitle = p.subtitle ?? "";
  if (AUTO.test(subtitle)) return false;
  if (!subtitle.includes("•")) return true;
  const author = subtitle.split("•")[0].trim().replace(/^@/, "").toLowerCase();
  return owners.some((o) => o.trim().replace(/^@/, "").toLowerCase() === author);
}
