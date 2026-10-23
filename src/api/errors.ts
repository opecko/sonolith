// Human-readable errors. A dropped connection surfaces as whatever the HTTP layer says ("error sending request for
// url (…)", "dns error", "offline" in the browser harness); those all mean the same thing to the user.

const NETWORK = /error sending request|dns error|failed to lookup|name resolution|connection (refused|reset|closed|aborted)|connect error|timed? ?out|network ?error|\boffline\b|failed to fetch|load failed|unreachable/i;

const textOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** No connection, or YouTube Music can't be reached (the browser's own flag counts too). */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return NETWORK.test(textOf(e)) || (e instanceof Error && e.cause !== undefined && NETWORK.test(textOf(e.cause)));
}

/** For toasts and inline messages: a sentence for connection problems, the error's own message otherwise. */
export function errorText(e: unknown): string {
  return isNetworkError(e) ? "No internet connection. Check your network and try again." : textOf(e);
}
