import { Check, History, LogOut, Settings, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sameAccount } from "../api/accounts";
import { currentAccount, getAccountSwitcher } from "../api/client";
import { getAccount } from "../api/ytm";
import { useAsync } from "../hooks/useData";
import { useAuth } from "../stores/auth";
import { openSettings, useNav } from "../stores/nav";

export default function Avatar() {
  const signedIn = useAuth((s) => s.status === "signedIn");
  const logout = useAuth((s) => s.logout);
  const login = useAuth((s) => s.login);
  const accountGen = useAuth((s) => s.accountGen);
  const { data } = useAsync(signedIn ? `account@${accountGen}` : "account:none", () => (signedIn ? getAccount() : Promise.resolve(null)));
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
        <div role="menu" aria-label="Account" className="m3-menu absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] py-2 shadow-2xl">
          {data && (
            <div className="m3-menu-header border-b border-[var(--c-outline)] px-4 pb-3 pt-1">
              <p className="truncate text-sm font-medium">{data.name}</p>
              {data.handle && <p className="truncate text-xs text-[var(--c-text-muted)]">{data.handle}</p>}
            </div>
          )}
          <AccountSwitcher onDone={() => setOpen(false)} />
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

/**
 * The other accounts and channels of the signed-in cookie (several Google accounts, brand accounts): picking one
 * makes every request act as it. Hidden when there's only the one account; loaded when the menu opens.
 */
function AccountSwitcher({ onDone }: { onDone: () => void }) {
  const accountGen = useAuth((s) => s.accountGen);
  const switchAccount = useAuth((s) => s.switchAccount);
  const { data: groups } = useAsync(`accounts@${accountGen}`, getAccountSwitcher);
  if (!groups || groups.reduce((n, g) => n + g.accounts.length, 0) < 2) return null;
  const current = currentAccount();
  return (
    <div role="group" aria-label="Switch account" className="m3-menu-section scroll-y max-h-72 border-b border-[var(--c-outline)] py-1">
      {groups.map((g, i) => (
        <div key={i}>
          {groups.length > 1 && (
            <p className="truncate px-4 pb-1 pt-2 text-xs text-[var(--c-text-muted)]" title={g.subtitle}>{g.title}</p>
          )}
          {g.accounts.map((a) => {
            const active = sameAccount(a, current);
            return (
              <button key={`${a.authUser}:${a.pageId ?? ""}`} role="menuitemradio" aria-checked={active}
                onClick={() => { onDone(); switchAccount(a); }}
                className="m3-menu-item flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-[var(--c-hover)]">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--c-surface-2)]">
                  {a.photo ? <img src={a.photo} alt="" className="h-full w-full object-cover" /> : <User size={16} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{a.name}</span>
                  {(a.handle || a.byline) && <span className="block truncate text-xs text-[var(--c-text-muted)]">{a.handle ?? a.byline}</span>}
                </span>
                {active && <Check size={16} aria-hidden className="shrink-0" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
