// Display text for Settings → Connected apps. Pure.
import { SCOPES, type Scope } from "./schema.gen";

/** "just now", "5 min ago", "yesterday", or the date. */
export function ago(at: number | null, now = Date.now()): string {
  if (at === null) return "never";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 2 * 86400) return "yesterday";
  return new Date(at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Scopes in the order the spec lists them, with what the user saw on the consent screen. */
export function scopeRows(scopes: readonly Scope[]) {
  return SCOPES.filter((s) => scopes.includes(s.scope));
}

/** The method names of an activity list as short lines: "player.getState", counted when they repeat. */
export function activityLines(activity: { method: string; at: number }[]): { method: string; at: number; count: number }[] {
  const out: { method: string; at: number; count: number }[] = [];
  for (const a of activity) {
    const last = out[out.length - 1];
    if (last && last.method === a.method) last.count++;
    else out.push({ ...a, count: 1 });
  }
  return out;
}

/** "Connected now" / "2 connections" / "Not running". */
export function connectionText(n: number): string {
  return n === 0 ? "Not running" : n === 1 ? "Connected now" : `Connected now (${n} connections)`;
}

/** "Allowed to: see what's playing, control playback", with the permission names from the spec. */
export function allowedSummary(scopes: readonly Scope[]): string {
  const rows = scopeRows(scopes);
  if (rows.length === 0) return "Not allowed to do anything";
  return `Allowed to: ${rows.map((s) => s.label.charAt(0).toLowerCase() + s.label.slice(1)).join(", ")}`;
}

/** A wait as a clock: "0:42", "10:00", "1:00:00". Rounded up, so it never shows 0:00 while still waiting. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** An app that may not ask again yet, with when it may (`Date.now()` time). */
export interface Hold {
  appId: string;
  name: string;
  /** Nobody answered (rather than a denial). */
  expired: boolean;
  until: number;
}

/** "Denied · can ask again in 0:42". */
export function holdText(h: Pick<Hold, "expired" | "until">, now = Date.now()): string {
  return `${h.expired ? "Not answered" : "Denied"} · can ask again in ${clock(h.until - now)}`;
}
