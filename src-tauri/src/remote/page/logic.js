// Pure helpers of the phone remote page (tested in logic.test.ts).

/** "m:ss", or "h:mm:ss" from an hour on. */
export function formatTime(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The pairing secret from the link's fragment (`#k=…`), or null. */
export function secretFromHash(hash) {
  const m = /^#k=([A-Za-z0-9_-]{16,128})$/.exec(hash || "");
  return m ? m[1] : null;
}

/**
 * Splits server-sent-event text into events. Returns the complete events and the unfinished rest, which goes in
 * front of the next chunk. Comment lines (keepalives) are skipped.
 */
export function parseEvents(text) {
  const blocks = text.replace(/\r/g, "").split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = [];
  for (const block of blocks) {
    let name = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) name = line.slice(7);
      else if (line.startsWith("data: ")) data.push(line.slice(6));
    }
    if (data.length) events.push({ name, data: data.join("\n") });
  }
  return { events, rest };
}

/**
 * Where playback is now. `positionMs` was the position at `positionAt` (Sonolith's clock); `serverNow` is Sonolith's
 * clock now, as the phone estimates it. While playing, the position moves on from there.
 */
export function positionNow(p, serverNow) {
  if (!p) return 0;
  const moving = p.status === "playing" ? (serverNow - p.positionAt) * (p.rate || 1) : 0;
  const pos = p.positionMs + Math.max(0, moving);
  return p.durationMs ? Math.min(pos, p.durationMs) : pos;
}

/** "Artist, Artist" from an item. */
export function artistLine(item) {
  if (!item) return "";
  const names = (item.artists || []).map((a) => a && a.name).filter(Boolean);
  if (names.length) return names.join(", ");
  return item.author || item.podcast?.title || "";
}

/** Reconnect delay: 1 s doubling up to 30 s. */
export function backoff(attempt) {
  return Math.min(30000, 1000 * 2 ** Math.max(0, attempt));
}

/** What to tell the user when the stream or pairing fails, by the server's error name. */
export function failureText(error) {
  switch (error) {
    case "wrongLink":
      return "This link is no longer valid. Open the current link from Sonolith's Settings, Phone remote.";
    case "tooManyAttempts":
      return "Too many attempts. Wait a few minutes, then open the link again.";
    case "tooManyPhones":
      return "Too many phones are paired. Make a new link in Sonolith to start over.";
    case "notPaired":
    case "refused":
      return "This phone is no longer paired. Open the current link from Sonolith's Settings, Phone remote.";
    default:
      return "Can't reach Sonolith. Check that it runs and the phone remote is on.";
  }
}
