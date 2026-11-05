// Recaps' files on disk (src-tauri/src/recap.rs): the play log and small JSON files. Writes go through one queue so
// checkpoints land in order; nothing here ever blocks playback (invoke is async, failures are logged and dropped).
import { invoke } from "@tauri-apps/api/core";
import { monthKey, parseLog, type PlayEntry } from "./playLog";

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

/** Appends entries to their month files (a later line with the same id replaces the earlier one). */
export function appendPlays(entries: PlayEntry[]): Promise<void> {
  const byMonth = new Map<string, string[]>();
  for (const e of entries) {
    const m = monthKey(e.startedAt);
    byMonth.set(m, [...(byMonth.get(m) ?? []), JSON.stringify(e)]);
  }
  return enqueue(async () => {
    for (const [month, lines] of byMonth) await invoke("recap_log_append", { month, text: lines.join("\n") });
  }).catch((e) => console.warn("play log write failed:", e));
}

/** Every logged play, oldest first. */
export async function readPlays(): Promise<PlayEntry[]> {
  await queue;
  const files = await invoke<{ month: string; text: string }[]>("recap_log_read");
  return parseLog(files.map((f) => f.text).join("\n"));
}

export const deletePlayLog = () => enqueue(() => invoke<void>("recap_log_delete"));
export const deleteAllRecapData = () => enqueue(() => invoke<void>("recap_delete_all"));

/** Saves the whole log as one JSON file in Downloads; returns where. */
export async function exportPlayLog(today: Date): Promise<string> {
  const plays = await readPlays();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return invoke<string>("recap_log_export", { date, text: JSON.stringify({ format: "sonolith-listening-log", version: 1, plays }, null, 1) });
}

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const text = await invoke<string | null>("recap_file_read", { name });
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export const writeJson = (name: string, value: unknown) =>
  enqueue(() => invoke<void>("recap_file_write", { name, text: JSON.stringify(value) }));

export const deleteJson = (name: string) => enqueue(() => invoke<void>("recap_file_delete", { name }));

export const listJson = (dir: string) => invoke<string[]>("recap_file_list", { dir }).catch(() => [] as string[]);
