/** YouTube Music thumbs rating. */
export type Rating = "LIKE" | "DISLIKE" | "INDIFFERENT";

/** Two-state menu action backed by feedback tokens ("Save to library" ↔ "Remove from library", pin, …). */
export interface MenuToggle {
  label: string;
  token: string;
  toggledLabel: string;
  toggledToken: string;
  /** Icon of the current state (BOOKMARK_BORDER, KEEP, …). */
  icon: string;
}

/** Server-provided menu data for a track (tokens/ids not available from the item itself). */
export interface TrackMenu {
  /** Library / episodes / played toggles, shown after "Add to queue". */
  toggles: MenuToggle[];
  /** "Pin to Listen again" toggle, shown last. */
  pin?: MenuToggle;
  historyRemoveToken?: string;
  creditsId?: string;
  artistId?: string;
  albumId?: string;
}

export interface Credits {
  title: string;
  sections: { title: string; text: string }[];
}

/** Podcast episode details shown on show / channel pages. */
export interface EpisodeInfo {
  /** "2.4K views • 8h ago" */
  meta?: string;
  /** Publish date as YouTube Music shows it ("Dec 5, 2024", "3 days ago"). */
  published?: string;
  description?: string;
  /** Listening progress: percent played, "3 min left" / "Played", total "57 min". */
  progress?: { percent: number; text?: string; played: boolean };
  durationText?: string;
}

export interface Track {
  type: "track";
  id: string;
  title: string;
  subtitle: string;
  thumbnail?: string;
  artists: string[];
  /** Browse ids of `artists`, index for index; a name without one stays plain text. */
  artistIds?: (string | undefined)[];
  album?: { id?: string; title: string };
  durationSec?: number;
  rating?: Rating;
  explicit?: boolean;
  menu?: TrackMenu;
  /** Podcast episode (speed control, −10/+30 s, optional video, not sent to Discord by default). */
  podcast?: boolean;
  episode?: EpisodeInfo;
  /** The podcast show an episode belongs to (id without the MPSP prefix, as for its page route). */
  show?: { id: string; title: string };
  /** Where the track entered the queue; autoplay tracks get a divider and can be dropped. */
  source?: "autoplay";
  /** A music video (official or uploaded), not the song itself; see songVersions.ts. */
  video?: boolean;
}

export interface AlbumRef {
  type: "album";
  id: string;
  title: string;
  subtitle: string;
  thumbnail?: string;
}

export interface PlaylistRef {
  type: "playlist";
  id: string;
  title: string;
  subtitle: string;
  thumbnail?: string;
}

export interface ArtistRef {
  type: "artist";
  id: string;
  title: string;
  subtitle: string;
  thumbnail?: string;
}

export type Item = (Track | AlbumRef | PlaylistRef | ArtistRef) & {
  /** Artwork shape: artists round, music videos wide, everything else square. */
  art?: "square" | "round" | "wide";
  /** Song/video/episode label or album/single/EP label, as YT Music shows it. */
  kind?: string;
  /** Podcast episode (or podcast show for playlists). */
  podcast?: boolean;
  /** Artist item that is really a user channel (podcast creator / profile), opened as a channel page. */
  channel?: boolean;
};

/** InnerTube continuation token; sent as `continuation` in the request body. */
export type Continuation = string;

export interface BrowseRef {
  browseId: string;
  params?: string;
}

/** Button on the search top-result card (Shuffle / Mix for artists, Play / Save for songs). */
export interface CardAction {
  kind: "shuffle" | "mix" | "play" | "save";
  label: string;
  playlistId?: string;
  params?: string;
  videoId?: string;
}

export interface Shelf {
  title: string;
  items: Item[];
  /** Top-result card buttons (layout "card"). */
  actions?: CardAction[];
  strapline?: string;
  layout?: "carousel" | "list" | "grid" | "card";
  /** Carousel of list rows (quick picks): rendered as a multi-row column grid. */
  compact?: boolean;
  more?: BrowseRef;
  next?: Continuation;
}

export interface Chip {
  label: string;
  selected: boolean;
  browse?: BrowseRef;
  /** Search filter chips carry search params instead of a browse endpoint. */
  searchParams?: string;
}

export type SearchGroup = "songs" | "videos" | "albums" | "artists" | "playlists" | "podcasts" | "episodes";

export interface SearchResults {
  top: Item[];
  topActions: CardAction[];
  /** Server-titled shelves (e.g. "Poslechnout znovu"). */
  shelves: Shelf[];
  groups: { id: SearchGroup; items: Item[] }[];
  /** A search for a podcast: its groups come first and show above everything else (searchOrder.ts). */
  podcastFirst?: boolean;
  chips: Chip[];
  messages: string[];
  next: Continuation | null;
}

export interface Suggestions {
  queries: string[];
  items: Item[];
}

export interface BrowsePage {
  shelves: Shelf[];
  chips: Chip[];
  messages: string[];
  next: Continuation | null;
}

export interface Page<T> {
  items: T[];
  loadMore: (() => Promise<Page<T>>) | null;
  /** Filter chips of the first page (home moods), if any. */
  chips?: Chip[];
}

export interface Playlist extends Omit<PlaylistRef, "type"> {
  type: "playlist";
  tracks: Track[];
  loadMore: (() => Promise<Playlist>) | null;
}

export interface Album extends Omit<AlbumRef, "type"> {
  type: "album";
  tracks: Track[];
  related: Shelf[];
}

export interface Artist extends Omit<ArtistRef, "type"> {
  type: "artist";
  shelves: Shelf[];
}

export interface QueueChip {
  id: string;
  label: string;
  endpoint: { videoId?: string; playlistId?: string; params?: string } | null;
  /** The chip the server marks active (usually "All"); its tracks = the original upcoming list. */
  selected?: boolean;
}


export type LibrarySection = "playlists" | "songs" | "albums" | "artists" | "liked" | "podcasts" | "episodes";

/** A podcast episode (never a song): plays alone or with its show, never starts a music radio. */
export const isEpisode = (i: { type: string; podcast?: boolean }): boolean => i.type === "track" && !!i.podcast;
/** A podcast show (a playlist-like page of episodes). */
export const isShow = (i: { type: string; podcast?: boolean }): boolean => i.type === "playlist" && !!i.podcast;
export type SearchType = "song" | "video" | "album" | "playlist" | "artist";
