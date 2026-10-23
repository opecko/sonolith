import { History, LogOut, Settings, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getAccount } from "../api/ytm";
import { useAsync } from "../hooks/useData";
import { useAuth } from "../stores/auth";
import { openSettings, useNav } from "../stores/nav";

export default function Avatar() {
  const signedIn = useAuth((s) => s.status === "signedIn");
  const logout = useAuth((s) => s.logout);
  const login = useAuth((s) => s.login);
  const { data } = useAsync(signedIn ? "account" : "account:none", () => (signedIn ? getAccount() : Promise.resolve(null)));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!signedIn) return <button onClick={login} className="chip">Sign in</button>;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Account" aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[var(--c-surface-3)] ring-offset-2 ring-offset-[var(--c-bg)] hover:ring-2 hover:ring-[var(--c-outline)]">
        {data?.photo ? <img src={data.photo} alt="" className="h-full w-full object-cover" /> : <User size={18} />}
      </button>
      {open && (
        // The same menu surface as the ⋮ menus (m3-menu): M3 in the M3 style, unchanged in Classic.
        <div role="menu" aria-label="Account" className="m3-menu absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] py-2 shadow-2xl">
          {data && (
            <div className="m3-menu-header border-b border-[var(--c-outline)] px-4 pb-3 pt-1">
              <p className="truncate text-sm font-medium">{data.name}</p>
              {data.handle && <p className="truncate text-xs text-[var(--c-text-muted)]">{data.handle}</p>}
            </div>
          )}
          <button onClick={() => { setOpen(false); useNav.getState().go({ name: "history" }); }} role="menuitem" className="m3-menu-item mt-1 flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--c-hover)]">
            <span aria-hidden><History size={18} /></span> History
          </button>
          <button onClick={() => { setOpen(false); openSettings(); }} role="menuitem" className="m3-menu-item flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--c-hover)]">
            <span aria-hidden><Settings size={18} /></span> Settings
          </button>
          <button onClick={() => { setOpen(false); logout(); }} role="menuitem" className="m3-menu-item flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--c-hover)]">
            <span aria-hidden><LogOut size={18} /></span> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
