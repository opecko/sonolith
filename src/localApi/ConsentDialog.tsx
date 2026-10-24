import { AlertTriangle, AppWindow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { consentTitle, identityRows } from "./consent";
import { SCOPES, type AppIdentity, type Scope } from "./schema.gen";
import { useLocalApi, type Consent } from "./store";

function Identity({ identity, label }: { identity: AppIdentity; label?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-fg/5 px-3 py-2 text-xs">
      {label && <div className="font-medium text-[var(--c-text-muted)]">{label}</div>}
      {identityRows(identity).map((r) => (
        <div key={r.label} className="flex gap-2">
          <span className="w-20 shrink-0 text-[var(--c-text-muted)]">{r.label}</span>
          <span className="min-w-0 select-text break-all font-[ui-monospace,monospace]">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Request({ c, more }: { c: Consent; more: number }) {
  const answer = useLocalApi((s) => s.answer);
  // Optional scopes start ticked; the user may untick them.
  const [unticked, setUnticked] = useState<Set<Scope>>(new Set());
  const deny = useRef<HTMLButtonElement>(null);
  useEffect(() => deny.current?.focus(), [c.requestId]);
  const chosen = c.scopes.filter((s) => !s.required && !unticked.has(s.scope)).map((s) => s.scope);
  const toggle = (s: Scope) => setUnticked((u) => {
    const n = new Set(u);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    return n;
  });
  const btn = "h-10 rounded-full px-5 text-sm font-medium";
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="consent-title"
      className="m3-dialog flex max-h-full w-[min(520px,100%)] flex-col gap-4 overflow-y-auto rounded-lg border border-[var(--c-outline)] bg-[var(--c-surface-3)] p-6 shadow-2xl">
      <div className="flex items-start gap-3">
        {c.icon ? <img src={c.icon} alt="" className="size-12 shrink-0 rounded-md" /> : <AppWindow size={48} className="shrink-0 text-[var(--c-text-muted)]" aria-hidden />}
        <div className="min-w-0 flex-1">
          <h2 id="consent-title" className="text-lg font-semibold">{consentTitle(c)}</h2>
          <div className="select-text text-sm text-[var(--c-text-muted)]">
            by {c.publisher}{c.homepage && <> · <span className="break-all">{c.homepage}</span></>}
          </div>
        </div>
        {more > 0 && <span className="shrink-0 text-xs text-[var(--c-text-muted)]">+{more} more</span>}
      </div>
      <p className="select-text text-sm">{c.description}</p>
      {c.alreadyRegistered && (
        <p className="text-sm text-[var(--c-text-muted)]">An app with this id is already connected. Allowing replaces it, and its open connections end.</p>
      )}
      {c.kind === "identity" && c.previousIdentity ? (
        <>
          <p className="text-sm">It runs from a different place than the one you allowed. Allow it again to keep its access.</p>
          <Identity identity={c.previousIdentity} label="Allowed before" />
          <Identity identity={c.identity} label="Now" />
        </>
      ) : (
        <Identity identity={c.identity} />
      )}
      {c.scopes.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{c.name} wants to:</div>
          {c.scopes.map((s) => (
            <label key={s.scope} className={`flex items-start gap-3 rounded-md px-1 py-1 ${s.required ? "" : "cursor-pointer hover:bg-[var(--c-hover)]"}`}>
              {s.required ? <span className="size-4 shrink-0" /> : (
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--c-accent)]" checked={!unticked.has(s.scope)} onChange={() => toggle(s.scope)} />
              )}
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {s.label}
                  {s.sensitive && <AlertTriangle size={14} className="text-[var(--c-error)]" aria-label="Sensitive" />}
                </span>
                <span className="block select-text text-xs text-[var(--c-text-muted)]">{s.reason}</span>
              </span>
            </label>
          ))}
          {c.grantedScopes.length > 0 && (
            <p className="text-xs text-[var(--c-text-muted)]">It already can: {c.grantedScopes.map((g) => SCOPES.find((x) => x.scope === g)?.label ?? g).join(", ").toLowerCase()}.</p>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
        <button className={`${btn} m3-btn m3-text mr-auto text-[var(--c-error)] hover:bg-[var(--c-hover)]`} onClick={() => void answer(c.requestId, "block", [])}>
          Deny and block this app
        </button>
        <button ref={deny} className={`${btn} m3-btn m3-text border border-[var(--c-outline)] hover:bg-[var(--c-hover)]`} onClick={() => void answer(c.requestId, "deny", [])}>Deny</button>
        <button className={`${btn} m3-btn m3-filled bg-button text-on-button hover:bg-button/90`} onClick={() => void answer(c.requestId, "allow", chosen)}>Allow</button>
      </div>
    </div>
  );
}

/**
 * Consent for apps that want to use the local API (api/SPEC.md 6.2), one request at a time. Mounted once in App.
 * Only the buttons answer: an accidental Esc or click outside must not deny (that starts a cooldown).
 */
export default function ConsentDialog() {
  const consents = useLocalApi((s) => s.consents);
  const c = consents[0];
  if (!c) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--c-overlay)] p-6">
      <Request key={c.requestId} c={c} more={consents.length - 1} />
    </div>
  );
}
