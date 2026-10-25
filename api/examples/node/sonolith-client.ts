/**
 * A complete Sonolith API client: connect, register, store the token, subscribe, handle revoke, unregister.
 *
 * No dependencies. Node.js 22.18+ / 23.6+ runs TypeScript directly:
 *
 *   node sonolith-client.ts register    # the user action: asks Sonolith for access, then runs
 *   node sonolith-client.ts run         # connects with the stored token and prints events
 *   node sonolith-client.ts status      # prints the current state once
 *   node sonolith-client.ts disconnect  # "Disconnect from Sonolith": unregisters and deletes the token
 *
 * The token goes to a file only the user can read. A real app SHOULD prefer the OS secret store
 * (for example the `@napi-rs/keyring` package).
 *
 * Works on Linux (Unix socket) and Windows (named pipe): `net.connect` handles both.
 */

import { connect, type Socket } from "node:net";
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const APP_ID = "com.example.sonolith-demo-node";
const API_VERSION = "1.0";
const MAX_MESSAGE = 1024 * 1024;
const WINDOWS = process.platform === "win32";

const REGISTRATION = {
  appId: APP_ID,
  name: "Sonolith Demo (Node)",
  description: "An example client that prints what Sonolith is playing.",
  publisher: "Sonolith API examples",
  homepage: "https://github.com/opecko/sonolith/tree/master/api/examples",
  scopes: [
    { scope: "player:read", required: true, reason: "To print the current song" },
    { scope: "lyrics:read", required: false, reason: "To print the current lyric line" },
  ],
  apiVersion: API_VERSION,
};

// ---------------------------------------------------------------- token storage

const tokenFile = WINDOWS
  ? join(process.env.APPDATA ?? homedir(), "sonolith-demo-node", "token")
  : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "sonolith-demo-node", "token");

const tokens = {
  load(): string | null {
    try {
      return readFileSync(tokenFile, "utf8").trim() || null;
    } catch {
      return null;
    }
  },
  save(token: string): void {
    mkdirSync(dirname(tokenFile), { recursive: true, mode: 0o700 });
    writeFileSync(tokenFile, token, { mode: 0o600 });
  },
  delete(): void {
    rmSync(tokenFile, { force: true });
  },
};

// ---------------------------------------------------------------- discovery

class NotAvailable extends Error {}

function runtimeDir(): string {
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg) return join(xdg, "sonolith");
  const dir = `/tmp/sonolith-${process.getuid!()}`;
  try {
    const st = statSync(dir);
    if (st.uid !== process.getuid!() || (st.mode & 0o077) !== 0) throw new NotAvailable(`${dir} is not private to this user`);
  } catch (e) {
    if (e instanceof NotAvailable) throw e;
  }
  return dir;
}

function discover(): string {
  const file = WINDOWS
    ? join(process.env.LOCALAPPDATA ?? "", "Sonolith", "api", "discovery.json")
    : join(runtimeDir(), "discovery.json");
  try {
    return JSON.parse(readFileSync(file, "utf8")).path;
  } catch {
    // Windows clients must not guess the pipe name. (Node cannot check the pipe's server process id;
    // see the spec's security model.)
    if (WINDOWS) throw new NotAvailable("no discovery.json");
    return join(runtimeDir(), "api.sock");
  }
}

// ---------------------------------------------------------------- JSON-RPC connection

interface Notification {
  method: string;
  params?: any;
}

class RpcError extends Error {
  code: number;
  name: string;
  data: any;
  constructor(error: any) {
    const data = error.data ?? {};
    super(`${data.name ?? error.message} (${error.code}): ${data.reason ?? error.message}`);
    this.code = error.code;
    this.name = data.name ?? error.message;
    this.data = data;
  }
}

class Connection {
  private socket: Socket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private queue: (Notification | null)[] = [];
  private waiters: ((n: Notification | null) => void)[] = [];
  private buffer = "";

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("close", () => this.onClose());
    socket.on("error", () => {});
  }

  static open(): Promise<Connection> {
    const path = discover();
    return new Promise((resolve, reject) => {
      const socket = connect(path);
      socket.once("connect", () => resolve(new Connection(socket)));
      socket.once("error", (e) => reject(new NotAvailable(e.message)));
    });
  }

  call(method: string, params?: object): Promise<any> {
    const id = this.nextId++;
    const line = JSON.stringify(params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params }) + "\n";
    if (Buffer.byteLength(line) > MAX_MESSAGE) throw new Error("message too large");
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(line);
    });
  }

  nextEvent(): Promise<Notification | null> {
    const n = this.queue.shift();
    if (n !== undefined) return Promise.resolve(n);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.socket.end();
  }

  private push(n: Notification | null): void {
    const w = this.waiters.shift();
    if (w) w(n);
    else this.queue.push(n);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const waiter = msg.id != null ? this.pending.get(msg.id) : undefined;
      if (waiter) {
        this.pending.delete(msg.id);
        if (msg.error) waiter.reject(new RpcError(msg.error));
        else waiter.resolve(msg.result);
      } else if (typeof msg.method === "string") {
        this.push({ method: msg.method, params: msg.params });
      }
    }
  }

  private onClose(): void {
    for (const w of this.pending.values()) w.reject(new NotAvailable("connection closed"));
    this.pending.clear();
    this.push(null);
  }
}

// ---------------------------------------------------------------- flows

const say = (text: string) => console.log(text);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** `retryAfterMs` for people: "40 s" or "10 min", rounded up. */
const waitText = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
};

/** Asks the user for access. Call it only because the user asked (here: the `register` command). */
async function register(): Promise<boolean> {
  const conn = await Connection.open();
  try {
    let pending: any;
    try {
      pending = await conn.call("app.register", REGISTRATION);
    } catch (e) {
      if (!(e instanceof RpcError)) throw e;
      if (e.name === "Blocked") say("Sonolith blocked this app. You can unblock it in Sonolith's Settings → Connected apps.");
      else if (e.name === "RegistrationDenied") say(`Access was denied recently. You can try again in ${waitText(e.data.retryAfterMs)}.`);
      else if (e.name === "RegistrationPending") say("A request from this app is already waiting. Answer it in Sonolith.");
      else throw e;
      return false;
    }
    say("Waiting for you to approve “Sonolith Demo (Node)” in Sonolith…");
    for (;;) {
      const msg = await conn.nextEvent();
      if (!msg) throw new NotAvailable("Sonolith closed the connection; the request was cancelled");
      if (msg.method !== "registration.resolved" || msg.params.requestId !== pending.requestId) continue;
      const p = msg.params;
      if (p.status === "approved") {
        tokens.save(p.token); // store first: it is sent only once
        say(`Connected. Granted: ${p.grantedScopes.join(", ")}`);
        return true;
      }
      if (p.status === "blocked") say("Sonolith blocked this app. You can unblock it in Sonolith's Settings → Connected apps.");
      else if (p.status === "denied") say(`Access was denied. You can try again in ${waitText(p.retryAfterMs)}.`);
      else say("Nobody answered in time. Run `register` again to retry.");
      return false;
    }
  } finally {
    conn.close();
  }
}

/** Authenticates; returns the session, or null when the app lost its access. */
async function hello(conn: Connection, token: string): Promise<any | null> {
  for (;;) {
    try {
      return await conn.call("session.hello", { appId: APP_ID, token, apiVersion: API_VERSION });
    } catch (e) {
      if (!(e instanceof RpcError)) throw e;
      if (e.name === "Unauthorized" || e.name === "NotRegistered" || e.name === "Blocked") {
        tokens.delete();
        say("Disconnected from Sonolith." + (e.name === "Blocked" ? " (This app is blocked in Sonolith.)" : ""));
        return null;
      }
      if (e.name !== "RegistrationPending") throw e;
      say("This app's executable changed; approve it again in Sonolith…");
      let msg: Notification | null;
      do {
        msg = await conn.nextEvent();
        if (!msg) throw new NotAvailable("connection closed");
      } while (msg.method !== "registration.resolved" || msg.params.requestId !== e.data.requestId);
      if (msg.params.status !== "approved") {
        say("Not approved.");
        return null;
      }
    }
  }
}

function describe(item: any): string {
  if (!item) return "nothing";
  if (item.type === "episode") return `${item.title} (${item.podcast?.title ?? "podcast"})`;
  return `${item.title} – ${item.artists.map((a: any) => a.name).join(", ")}`;
}

/** Runs until revoked or interrupted, reconnecting with backoff. */
async function run(): Promise<void> {
  let delay = 1000;
  for (;;) {
    const token = tokens.load();
    if (!token) return say("Not connected to Sonolith. Run `register` to connect.");
    let conn: Connection;
    try {
      conn = await Connection.open();
    } catch (e) {
      if (!(e instanceof NotAvailable)) throw e;
      say(`Sonolith is not available (not running, or “Allow other apps to connect” is off). Retrying in ${Math.round(delay / 1000)} s.`);
      await sleep(delay * (0.8 + Math.random() * 0.4));
      delay = Math.min(delay * 2, 60_000);
      continue;
    }
    try {
      const session = await hello(conn, token);
      if (!session) return;
      delay = 1000;
      const topics = ["player.track", "player.state"];
      if (session.grantedScopes.includes("lyrics:read")) topics.push("lyrics.line");
      await conn.call("events.subscribe", { topics });
      for (;;) {
        const msg = await conn.nextEvent();
        if (!msg) {
          say("Sonolith went away.");
          break;
        }
        const p = msg.params ?? {};
        if (msg.method === "player.trackChanged") say(`♪ ${describe(p.item)}`);
        else if (msg.method === "player.stateChanged") say(`  [${p.status}]`);
        else if (msg.method === "lyrics.line" && p.text) say(`  “${p.text}”`);
        else if (msg.method === "session.scopesChanged") say(`  scopes now: ${p.grantedScopes.join(", ")}`);
        else if (msg.method === "session.revoked") {
          tokens.delete();
          return say("Disconnected from Sonolith.");
        }
        // Unknown notifications are ignored.
      }
    } catch (e) {
      if (!(e instanceof NotAvailable)) throw e;
      say("Sonolith went away.");
    } finally {
      conn.close();
    }
    await sleep(delay * (0.8 + Math.random() * 0.4)); // never reconnect in a tight loop
    delay = Math.min(delay * 2, 60_000);
  }
}

async function status(): Promise<void> {
  const token = tokens.load();
  if (!token) return say("Not connected to Sonolith. Run `register` to connect.");
  const conn = await Connection.open();
  try {
    if (await hello(conn, token)) {
      const s = await conn.call("player.getState");
      say(`${s.status}: ${describe(s.item)} at ${Math.floor(s.positionMs / 1000)} s`);
    }
  } finally {
    conn.close();
  }
}

/** The "Disconnect from Sonolith" action: unregister, and delete the token in any case. */
async function disconnect(): Promise<void> {
  const token = tokens.load();
  try {
    if (token) {
      const conn = await Connection.open();
      try {
        if (await hello(conn, token)) await conn.call("app.unregister");
      } finally {
        conn.close();
      }
    }
  } catch (e) {
    say(`Could not reach Sonolith (${(e as Error).message}); the app stays listed there until you remove it.`);
  } finally {
    tokens.delete();
  }
  say("Disconnected from Sonolith.");
}

const commands: Record<string, () => Promise<void>> = {
  register: async () => {
    if (await register()) await run();
  },
  run,
  status,
  disconnect,
};

const command = commands[process.argv[2] ?? ""];
if (!command) {
  say("usage: node sonolith-client.ts register | run | status | disconnect");
} else {
  command().catch((e) => {
    say(e instanceof NotAvailable ? `Sonolith is not available: ${e.message}` : String(e));
    process.exitCode = 1;
  });
}
