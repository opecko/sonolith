// Errors the frontend answers with; the server turns them into JSON-RPC errors (src-tauri/src/api/protocol.rs).
import { AuthError } from "../api/client";
import { isNetworkError } from "../api/errors";
import type { ErrorName } from "./schema.gen";

export class ApiError extends Error {
  constructor(
    readonly error: ErrorName,
    readonly reason: string | null = null,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(reason ? `${error}: ${reason}` : error);
  }
}

export const nothingPlaying = () => new ApiError("Unavailable", "nothingPlaying");
export const notFound = () => new ApiError("NotFound");
export const invalidParam = (path: string) => new ApiError("InvalidParams", null, { path });

/** YouTube's answers for ids that don't exist, and youtubei.js' for pages it can't read. */
const MISSING = /status code 40[04]|\b404\b|not found|does not exist|invalid (id|browse)/i;
const NOT_EDITABLE = /cannot be edited|not (the )?owner|permission/i;

/** The bridge's error object (`name`, `reason`, extra members) for anything a handler threw. */
export function bridgeError(e: unknown, opts: { missing?: boolean; editable?: boolean } = {}): Record<string, unknown> {
  if (e instanceof ApiError) return { ...e.extra, name: e.error, reason: e.reason };
  if (e instanceof AuthError) return { name: "NotSignedIn", reason: null };
  const text = e instanceof Error ? e.message : String(e);
  if (isNetworkError(e)) return { name: "Timeout", reason: null };
  if (opts.editable && NOT_EDITABLE.test(text)) return { name: "Unavailable", reason: "notEditable" };
  if (opts.missing && MISSING.test(text)) return { name: "NotFound", reason: null };
  console.warn("local API call failed:", e);
  return { name: "InternalError", reason: null };
}
