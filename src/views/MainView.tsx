import { useEffect, useRef } from "react";
import { ErrorBoundary } from "../components/Status";
import { useAuth } from "../stores/auth";
import { useNav } from "../stores/nav";
import AlbumView from "./AlbumView";
import BrowseView from "./BrowseView";
import ArtistView from "./ArtistView";
import ExploreView from "./ExploreView";
import ChannelView from "./ChannelView";
import HistoryView from "./HistoryView";
import PodcastView from "./PodcastView";
import HomeView from "./HomeView";
import LibraryView from "./LibraryView";
import PlaylistView from "./PlaylistView";
import SearchView from "./SearchView";
import SettingsView from "./SettingsView";

function SignInPrompt() {
  const { login, error } = useAuth();
  return (
    <div className="mx-auto mt-24 max-w-sm text-center">
      <h2 className="text-2xl font-bold tracking-tight">Sign in to YouTube Music</h2>
      <p className="mt-2 text-sm text-[var(--c-text-muted)]">A Google sign-in window will open. Your cookies are stored in the OS keyring.</p>
      <button onClick={login} className="m3-btn m3-filled mt-6 h-10 rounded-full bg-button px-6 text-sm font-medium text-on-button hover:scale-105">Sign in</button>
      {error && <p className="mt-3 text-sm text-[var(--c-error)]">{error}</p>}
    </div>
  );
}

function Routed() {
  const route = useNav((s) => s.route);
  switch (route.name) {
    case "home": return <HomeView />;
    case "explore": return <ExploreView />;
    case "library": return <LibraryView />;
    case "settings": return <SettingsView />;
    case "history": return <HistoryView />;
    case "podcast": return <PodcastView key={route.id} id={route.id} />;
    case "channel": return <ChannelView key={route.id} id={route.id} />;
    case "search": return <SearchView key={route.query} query={route.query} />;
    case "playlist": return <PlaylistView key={route.id} id={route.id} />;
    case "album": return <AlbumView key={route.id} id={route.id} />;
    case "artist": return <ArtistView key={route.id} id={route.id} />;
    case "browse": return <BrowseView key={`${route.id}:${route.params}`} browseId={route.id} params={route.params} title={route.title} />;
  }
}

export default function MainView() {
  const status = useAuth((s) => s.status);
  const route = useNav((s) => s.route);
  const ref = useRef<HTMLElement>(null);
  const key = "id" in route ? `${route.name}:${route.id}:${"params" in route ? route.params : ""}` : "query" in route ? `search:${route.query}` : route.name;
  useEffect(() => {
    ref.current?.scrollTo(0, 0);
  }, [key]);

  return (
    <main ref={ref} className="scroll-y min-h-0 flex-1 px-8 pb-8 pt-6">
      {status === "loading" ? null : status === "signedOut" ? <SignInPrompt /> : <ErrorBoundary key={key}><Routed /></ErrorBoundary>}
    </main>
  );
}
