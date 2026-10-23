import { Compass, House, Library, Plus, Settings } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { prefetchItem } from "../stores/actions";
import { useAuth } from "../stores/auth";
import { useLibrary } from "../stores/library";
import ItemMenu from "./ItemMenu";
import { useNav, type Route } from "../stores/nav";
import { useToast } from "../stores/toast";

const items: { label: string; route: Route; icon: ReactNode }[] = [
  { label: "Home", route: { name: "home" }, icon: <House size={24} /> },
  { label: "Explore", route: { name: "explore" }, icon: <Compass size={24} /> },
  { label: "Library", route: { name: "library" }, icon: <Library size={24} /> },
];

function NewPlaylist() {
  const create = useLibrary((s) => s.create);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const t = title.trim();
    if (!t) return setEditing(false);
    setBusy(true);
    try {
      const id = await create(t);
      setEditing(false);
      setTitle("");
      if (id) useNav.getState().go({ name: "playlist", id });
    } catch (e) {
      useToast.getState().show(`Could not create playlist: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };
  if (editing)
    return (
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="px-2">
        <input
          autoFocus
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => !title.trim() && setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          placeholder="Playlist name"
          aria-label="New playlist name"
          className="h-10 w-full select-text rounded-full border border-[var(--c-outline)] bg-[var(--c-surface-2)] px-4 text-sm outline-none focus:border-[var(--c-text-subtle)]"
        />
      </form>
    );
  return (
    <button onClick={() => setEditing(true)}
      className="m3-btn m3-fab mx-2 flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--c-hover)] text-sm font-medium hover:bg-[var(--c-active)]">
      <Plus size={20} aria-hidden /> New playlist
    </button>
  );
}

function PlaylistList() {
  const { playlists, error, load } = useLibrary();
  const route = useNav((s) => s.route);
  const go = useNav((s) => s.go);
  useEffect(() => {
    if (!playlists) void load();
  }, [playlists, load]);
  if (error) return <button onClick={() => void load()} className="px-4 py-2 text-left text-xs text-[var(--c-error)]">Playlists failed to load. Retry</button>;
  if (!playlists)
    return <div className="space-y-4 px-4 pt-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-8" />)}</div>;
  return (
    <ul className="space-y-0.5">
      {playlists.map((p) => {
        const active = route.name === "playlist" && route.id === p.id;
        return (
          <li key={p.id} className="group relative">
            <button onClick={() => go({ name: "playlist", id: p.id })} onPointerEnter={() => prefetchItem(p)} onPointerLeave={() => prefetchItem(null)}
              aria-current={active ? "page" : undefined}
              className={`m3-nav-sub w-full rounded-[var(--radius)] py-2 pl-4 pr-10 text-left hover:bg-[var(--c-hover)] ${active ? "bg-[var(--c-hover)]" : ""}`}>
              <span className="block truncate text-sm font-medium">{p.title}</span>
              {p.subtitle && <span className="block truncate text-xs text-[var(--c-text-muted)]">{p.subtitle}</span>}
            </button>
            {/* Shown on hover; right-click on the row opens it too. */}
            <ItemMenu item={p} className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100" />
          </li>
        );
      })}
    </ul>
  );
}

export default function Sidebar() {
  const current = useNav((s) => s.route.name);
  const go = useNav((s) => s.go);
  const signedIn = useAuth((s) => s.status === "signedIn");
  return (
    // Below lg a rail: icons only (names as tooltips), no playlist list (they're in Library).
    <nav aria-label="Main" className="m3-drawer flex w-60 shrink-0 flex-col border-r border-[var(--c-outline)] bg-[var(--c-bg)] max-lg:w-20">
      <div className="flex h-16 items-center gap-2 px-6 max-lg:justify-center max-lg:px-0">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--c-accent)]" aria-hidden>
          <span className="ml-0.5 h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-white" />
        </span>
        <span className="text-xl font-bold tracking-tight max-lg:hidden">ytdesk</span>
      </div>
      <div className="space-y-1 px-2 pt-2">
        {items.map(({ label, route, icon }) => {
          const active = current === route.name;
          return (
            <button key={label} onClick={() => go(route)} aria-current={active ? "page" : undefined} title={label}
              className={`m3-nav-item flex h-12 w-full items-center gap-6 rounded-[var(--radius)] px-4 text-left text-base hover:bg-[var(--c-hover)] max-lg:justify-center max-lg:px-0 ${active ? "bg-[var(--c-hover)] font-medium" : "text-[var(--c-text-muted)]"}`}>
              {icon}
              <span className="max-lg:sr-only">{label}</span>
            </button>
          );
        })}
      </div>
      <hr className="m3-divider mx-6 my-4 border-[var(--c-outline)] max-lg:mx-4" />
      {signedIn && (
        <div className="flex min-h-0 flex-1 flex-col max-lg:hidden">
          <NewPlaylist />
          <div className="scroll-y mt-4 min-h-0 flex-1 px-2 pb-4">
            <PlaylistList />
          </div>
        </div>
      )}
      <button onClick={() => go({ name: "settings" })} aria-current={current === "settings" ? "page" : undefined} title="Settings"
        className="m3-nav-item mx-2 mb-3 mt-auto flex h-10 items-center gap-6 rounded-[var(--radius)] px-4 text-sm text-[var(--c-text-muted)] hover:bg-[var(--c-hover)] max-lg:justify-center max-lg:px-0">
        <Settings size={20} aria-hidden /> <span className="max-lg:sr-only">Settings</span>
      </button>
    </nav>
  );
}
