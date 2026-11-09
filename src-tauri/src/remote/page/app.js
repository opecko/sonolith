// The phone remote page: pairs once with the secret from the link, then speaks the local API through Sonolith's
// bridge (events over /api/stream, requests to /api/rpc). Sonolith's Rust side checks every request.
import { artistLine, backoff, failureText, formatTime, parseEvents, positionNow, secretFromHash } from "/logic.js";

const KEY = "sonolith-remote";
const $ = (id) => document.getElementById(id);
const TOPICS = ["player.state", "player.track", "player.position", "player.volume"];

let creds = loadCreds();
let session = null;
let scopes = [];
let nextId = 1;
const waiting = new Map();
let pos = null;
let duration = 0;
let seeking = false;
let attempt = 0;
let unpaired = false;
let queueOn = false;
let ticker = null;
/** Sonolith's clock minus the phone's, from the stream's hello (the LAN delay is small next to a second). */
let clockOffset = 0;
const serverNow = () => Date.now() + clockOffset;

function loadCreds() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    return c && typeof c.appId === "string" && typeof c.token === "string" ? c : null;
  } catch {
    return null;
  }
}

function saveCreds(c) {
  creds = c;
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: pairing lasts until the page closes.
  }
}

function message(title, text, retry = false) {
  $("player").hidden = true;
  $("message").hidden = false;
  $("message-title").textContent = title;
  $("message-text").textContent = text;
  $("retry").hidden = !retry;
}

function showPlayer() {
  $("message").hidden = true;
  $("player").hidden = false;
}

/** The connection chip in the app bar; hidden while all is well. */
function setStatus(text) {
  const chip = $("status");
  chip.textContent = text;
  chip.hidden = !text;
}

async function pair(secret) {
  try {
    const r = await fetch("/api/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok && b.appId && b.token) {
      saveCreds({ appId: b.appId, token: b.token });
      return true;
    }
    if (!creds) message("Couldn't pair this phone", failureText(b.error));
  } catch {
    if (!creds) message("Couldn't pair this phone", failureText(null), true);
  }
  return false;
}

function retryLater() {
  if (unpaired) return;
  setStatus("Reconnecting…");
  setTimeout(connect, backoff(attempt++));
}

async function connect() {
  if (!creds) return;
  showPlayer();
  setStatus(attempt ? "Reconnecting…" : "Connecting…");
  let res;
  try {
    res = await fetch("/api/stream", { headers: { Authorization: `Bearer ${creds.appId}:${creds.token}` }, cache: "no-store" });
  } catch {
    return retryLater();
  }
  if (res.status === 401 || res.status === 403) {
    const b = await res.json().catch(() => ({}));
    return forget(failureText(b.error || "notPaired"));
  }
  if (!res.ok || !res.body) return retryLater();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const { events, rest } = parseEvents(buf);
      buf = rest;
      for (const e of events) onEvent(e);
    }
  } catch {
    // The connection dropped; reconnect below.
  }
  session = null;
  for (const w of waiting.values()) w.reject({ name: "Disconnected" });
  waiting.clear();
  retryLater();
}

function forget(text) {
  unpaired = true;
  saveCreds(null);
  message("This phone is not paired", text);
}

function onEvent(e) {
  let msg;
  try {
    msg = JSON.parse(e.data);
  } catch {
    return;
  }
  if (e.name === "hello") {
    session = msg.session;
    refreshTheme();
    if (typeof msg.serverTime === "number") clockOffset = msg.serverTime - Date.now();
    scopes = msg.hello.grantedScopes || [];
    attempt = 0;
    setStatus("");
    call("events.subscribe", { topics: TOPICS, positionHz: 1 }).catch(() => {});
    if (scopes.includes("queue:read")) enableQueue();
    return;
  }
  if (msg.id !== undefined && waiting.has(msg.id)) {
    const w = waiting.get(msg.id);
    waiting.delete(msg.id);
    if (msg.error) w.reject(msg.error.data || msg.error);
    else w.resolve(msg.result);
    return;
  }
  const p = msg.params || {};
  switch (msg.method) {
    case "player.stateChanged":
      applyState(p);
      break;
    case "player.trackChanged":
      showItem(p.item);
      break;
    case "player.position":
      setPosition(p);
      break;
    case "player.volumeChanged":
      showVolume(p.volume, p.muted);
      break;
    case "queue.changed":
      loadQueue(p.currentIndex);
      break;
    case "session.scopesChanged":
      scopes = p.grantedScopes || [];
      if (scopes.includes("queue:read")) enableQueue();
      else disableQueue();
      break;
    case "registration.resolved":
      if (p.status !== "approved") note("Sonolith didn't allow this. You can ask again later.");
      break;
    case "session.revoked":
      forget("This phone was unpaired in Sonolith. Scan the current QR code to pair it again.");
      break;
  }
}

/** A local API call through the bridge; the answer comes back on the stream. */
function call(method, params = {}) {
  if (!session) return Promise.reject({ name: "Disconnected" });
  const id = nextId++;
  const done = new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    setTimeout(() => waiting.delete(id) && reject({ name: "Timeout" }), 30000);
  });
  fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.appId}:${creds.token}`, "X-Session": session },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }).then((r) => {
    if (!r.ok) {
      waiting.get(id)?.reject({ name: "Rejected", status: r.status });
      waiting.delete(id);
    }
  }, () => {});
  return done;
}

function applyState(s) {
  showItem(s.item);
  setPosition(s);
  showVolume(s.volume, s.muted);
  showModes(s.shuffle, s.repeat);
  $("prev").disabled = s.canGoPrevious === false;
  $("next").disabled = s.canGoNext === false;
}

function showItem(item) {
  $("title").textContent = item ? item.title : "Nothing playing";
  $("artists").textContent = artistLine(item);
  const art = $("art");
  const url = item && typeof item.thumbnailUrl === "string" && item.thumbnailUrl.startsWith("https://") ? item.thumbnailUrl : null;
  if (url && art.getAttribute("src") !== url) art.src = url;
  art.hidden = !url;
  document.title = item ? `${item.title} · Sonolith remote` : "Sonolith remote";
}

function setPosition(p) {
  if (typeof p.positionMs !== "number") return;
  const positionAt = typeof p.positionAt === "number" ? p.positionAt : serverNow();
  pos = { positionMs: p.positionMs, positionAt, durationMs: p.durationMs || 0, status: p.status, rate: p.rate || 1 };
  duration = pos.durationMs;
  const playing = p.status === "playing";
  // The icons follow the class in CSS: `hidden` on an <svg> isn't the HTML property, so setting it did nothing.
  $("toggle").classList.toggle("playing", playing);
  $("toggle").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("position").disabled = !duration;
  $("duration").textContent = formatTime(duration);
  clearInterval(ticker);
  ticker = playing ? setInterval(drawPosition, 500) : null;
  drawPosition();
}

function drawPosition() {
  if (seeking) return;
  const now = positionNow(pos, serverNow());
  const fraction = duration ? now / duration : 0;
  const slider = $("position");
  slider.value = String(Math.round(fraction * 1000));
  slider.style.setProperty("--p", `${fraction * 100}%`);
  $("elapsed").textContent = formatTime(now);
}

const REPEAT_NEXT = { off: "all", all: "one", one: "off" };
const REPEAT_LABEL = { off: "Repeat: off", all: "Repeat: all", one: "Repeat: one" };
let repeat = "off";

function showModes(shuffle, mode) {
  if (typeof shuffle === "boolean") $("shuffle").setAttribute("aria-pressed", String(shuffle));
  if (mode in REPEAT_NEXT) {
    repeat = mode;
    const b = $("repeat");
    b.setAttribute("aria-pressed", String(mode !== "off"));
    b.setAttribute("aria-label", REPEAT_LABEL[mode]);
    b.classList.toggle("one", mode === "one");
  }
}

function showVolume(v, muted) {
  if (typeof muted === "boolean") {
    $("mute").setAttribute("aria-pressed", String(muted));
    $("mute").setAttribute("aria-label", muted ? "Unmute" : "Mute");
  }
  if (typeof v !== "number" || volumeHeld) return;
  const slider = $("volume");
  slider.value = String(v);
  slider.style.setProperty("--p", `${v}%`);
}

// Volume: at most one call every 150 ms while dragging, and the last value always.
let volumeHeld = false;
let volumeTimer = null;
function sendVolume() {
  volumeTimer = null;
  call("player.setVolume", { volume: Number($("volume").value) }).catch(() => {});
}

function note(text) {
  const n = $("queue-note");
  n.textContent = text;
  n.hidden = !text;
}

async function askForQueue() {
  $("queue-ask").disabled = true;
  try {
    const r = await call("app.requestScopes", {
      scopes: [{ scope: "queue:read", required: true, reason: "To show what plays next on the phone" }],
    });
    if (r.status === "granted") enableQueue();
    else note("Confirm on your computer: Sonolith asks whether this phone may see the queue.");
  } catch (e) {
    if (e && e.name === "RegistrationPending") note("Confirm on your computer: Sonolith asks whether this phone may see the queue.");
    else if (e && e.name === "RegistrationDenied") note("Sonolith didn't allow this. You can ask again later.");
    else note("Couldn't ask Sonolith. Try again.");
  } finally {
    $("queue-ask").disabled = false;
  }
}

function enableQueue() {
  if (queueOn) return;
  queueOn = true;
  note("");
  $("queue-ask").hidden = true;
  $("queue-title").hidden = false;
  call("events.subscribe", { topics: [...TOPICS, "queue"], positionHz: 1 }).catch(() => {});
}

function disableQueue() {
  queueOn = false;
  $("queue-ask").hidden = false;
  $("queue-title").hidden = true;
  $("queue-list").replaceChildren();
}

async function loadQueue(currentIndex) {
  if (!queueOn) return;
  try {
    const r = await call("queue.get", { fromIndex: Math.max(0, currentIndex || 0), limit: 20 });
    const list = $("queue-list");
    list.replaceChildren(
      ...(r.items || []).map((e) => {
        const li = document.createElement("li");
        if (e.index === currentIndex) li.className = "current";
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        const url = e.item && e.item.thumbnailUrl;
        if (typeof url === "string" && url.startsWith("https://")) img.src = url;
        const text = document.createElement("div");
        text.className = "q-text";
        const t = document.createElement("span");
        t.className = "q-title";
        t.textContent = e.item ? e.item.title : "";
        const a = document.createElement("span");
        a.className = "q-sub";
        a.textContent = artistLine(e.item);
        text.append(t, a);
        li.append(img, text);
        return li;
      }),
    );
  } catch {
    // The next queue.changed tries again.
  }
}

function wire() {
  $("toggle").addEventListener("click", () => call("player.toggle").catch(() => {}));
  $("prev").addEventListener("click", () => call("player.previous").catch(() => {}));
  $("next").addEventListener("click", () => call("player.next").catch(() => {}));
  $("shuffle").addEventListener("click", () => {
    const on = $("shuffle").getAttribute("aria-pressed") !== "true";
    showModes(on);
    call("player.setShuffle", { enabled: on }).catch(() => {});
  });
  $("repeat").addEventListener("click", () => {
    const mode = REPEAT_NEXT[repeat];
    showModes(undefined, mode);
    call("player.setRepeat", { mode }).catch(() => {});
  });
  $("mute").addEventListener("click", () => {
    const muted = $("mute").getAttribute("aria-pressed") !== "true";
    showVolume(undefined, muted);
    call("player.setVolume", { muted }).catch(() => {});
  });
  const position = $("position");
  position.addEventListener("input", () => {
    seeking = true;
    const ms = (Number(position.value) / 1000) * duration;
    position.style.setProperty("--p", `${Number(position.value) / 10}%`);
    $("elapsed").textContent = formatTime(ms);
  });
  position.addEventListener("change", () => {
    const ms = Math.round((Number(position.value) / 1000) * duration);
    seeking = false;
    if (pos) pos = { ...pos, positionMs: ms, positionAt: serverNow() };
    call("player.seek", { positionMs: ms }).catch(() => {});
  });
  const volume = $("volume");
  volume.addEventListener("input", () => {
    volumeHeld = true;
    volume.style.setProperty("--p", `${volume.value}%`);
    if (!volumeTimer) volumeTimer = setTimeout(sendVolume, 150);
  });
  volume.addEventListener("change", () => {
    volumeHeld = false;
    clearTimeout(volumeTimer);
    sendVolume();
  });
  $("queue-ask").addEventListener("click", askForQueue);
  $("retry").addEventListener("click", () => location.reload());
}

/** The browser's bar (and an installed app's title bar) in the app's background color. */
function themeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--c-bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]').setAttribute("content", bg);
}

/**
 * The app's colors again: they may have changed since the page loaded (another palette, or Sonolith had only just
 * started and hadn't sent them yet). On every (re)connection and whenever the page comes back to the front.
 */
function refreshTheme() {
  const old = document.querySelector('link[href^="/theme.css"]');
  const link = old.cloneNode();
  link.href = `/theme.css?t=${Date.now()}`;
  link.addEventListener("load", () => {
    old.remove();
    themeColor();
  });
  old.after(link);
}

async function start() {
  wire();
  themeColor();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshTheme());
  const secret = secretFromHash(location.hash);
  if (secret) {
    // The secret leaves the address bar and history at once.
    history.replaceState(null, "", "/");
    await pair(secret);
  }
  if (!creds) {
    if ($("message").hidden) message("Pair this phone", "Open the link or scan the QR code from Sonolith's Settings, Phone remote.");
    return;
  }
  connect();
}

start();
