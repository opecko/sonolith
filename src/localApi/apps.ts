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

/** "Connected now" / "2 connections" / "Not connected". */
export function connectionText(n: number): string {
  return n === 0 ? "Not connected" : n === 1 ? "Connected now" : `Connected now (${n} connections)`;
}
