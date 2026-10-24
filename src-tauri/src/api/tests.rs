//! Integration tests: a real server behind a real Unix socket, real clients speaking line-delimited JSON-RPC, and a
//! fake host standing in for the Tauri app (consent answers, frontend bridge).

use super::identity::{AppIdentity, Kind};
use super::server::{Decision, Host, Server};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;
use tokio::sync::mpsc;

const WAIT: Duration = Duration::from_secs(5);

#[derive(Default)]
struct FakeHost {
    emitted: Mutex<Vec<(String, Value)>>,
    notified: Mutex<Vec<String>>,
    /// Receives `api:call` payloads when a test plays the frontend.
    calls: Mutex<Option<mpsc::UnboundedSender<Value>>>,
}

impl Host for FakeHost {
    fn emit(&self, event: &str, payload: Value) {
        if event == "api:call" {
            if let Some(tx) = self.calls.lock().unwrap().as_ref() {
                let _ = tx.send(payload.clone());
            }
        }
        self.emitted.lock().unwrap().push((event.to_string(), payload));
    }
    fn notify(&self, request_id: &str, _title: &str, _body: &str) {
        self.notified.lock().unwrap().push(request_id.to_string());
    }
    fn close_notification(&self, _request_id: &str) {}
}

impl FakeHost {
    fn emitted(&self, event: &str) -> Vec<Value> {
        self.emitted.lock().unwrap().iter().filter(|(e, _)| e == event).map(|(_, p)| p.clone()).collect()
    }

    async fn wait_for(&self, event: &str, pred: impl Fn(&Value) -> bool) -> Value {
        for _ in 0..200 {
            if let Some(v) = self.emitted(event).into_iter().find(|v| pred(v)) {
                return v;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("no {event} event");
    }
}

struct Env {
    server: Arc<Server>,
    host: Arc<FakeHost>,
    socket: PathBuf,
    dir: PathBuf,
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn temp_dir(name: &str) -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!("sonolith-api-test-{}-{name}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A server listening on a socket in a fresh temp dir, through the transport's own accept loop.
async fn start(name: &str) -> Env {
    let dir = temp_dir(name);
    let host = Arc::new(FakeHost::default());
    let server = Server::new(host.clone(), dir.join("api-apps.json"), "9.9.9".into());
    let socket = dir.join("api.sock");
    let listener = tokio::net::UnixListener::bind(&socket).unwrap();
    tokio::spawn(super::transport::accept_unix(listener, server.clone()));
    Env { server, host, socket, dir }
}

struct Client {
    rd: BufReader<OwnedReadHalf>,
    wr: Option<OwnedWriteHalf>,
    next_id: u64,
    /// Notifications read while waiting for a response.
    notes: VecDeque<Value>,
}

impl Client {
    async fn connect(path: &std::path::Path) -> Client {
        Client::over(UnixStream::connect(path).await.unwrap())
    }

    fn over(stream: UnixStream) -> Client {
        let (rd, wr) = stream.into_split();
        Client { rd: BufReader::new(rd), wr: Some(wr), next_id: 1, notes: VecDeque::new() }
    }

    async fn send(&mut self, method: &str, params: Value) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        let mut line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string();
        line.push('\n');
        self.wr.as_mut().unwrap().write_all(line.as_bytes()).await.unwrap();
        id
    }

    /// The next message, or None when the server closed the connection.
    async fn recv(&mut self) -> Option<Value> {
        let mut line = String::new();
        let n = tokio::time::timeout(WAIT, self.rd.read_line(&mut line)).await.expect("timed out waiting for a message").unwrap();
        (n > 0).then(|| serde_json::from_str(&line).unwrap())
    }

    /// Calls a method; Ok(result) or Err(error object).
    async fn call(&mut self, method: &str, params: Value) -> Result<Value, Value> {
        let id = self.send(method, params).await;
        loop {
            let msg = self.recv().await.unwrap_or_else(|| panic!("closed while waiting for {method}"));
            if msg["id"] == id {
                return match msg.get("error") {
                    Some(e) => Err(e.clone()),
                    None => Ok(msg["result"].clone()),
                };
            }
            self.notes.push_back(msg);
        }
    }

    async fn ok(&mut self, method: &str, params: Value) -> Value {
        self.call(method, params).await.unwrap_or_else(|e| panic!("{method} failed: {e}"))
    }

    async fn err(&mut self, method: &str, params: Value) -> Value {
        match self.call(method, params).await {
            Ok(r) => panic!("{method} should fail, got {r}"),
            Err(e) => e,
        }
    }

    /// The next notification with this method (earlier ones of other methods are kept).
    async fn note(&mut self, method: &str) -> Value {
        if let Some(i) = self.notes.iter().position(|n| n["method"] == method) {
            return self.notes.remove(i).unwrap()["params"].clone();
        }
        loop {
            let msg = self.recv().await.unwrap_or_else(|| panic!("closed while waiting for {method}"));
            if msg["method"] == method {
                return msg["params"].clone();
            }
            self.notes.push_back(msg);
        }
    }

    /// Reads until the server closes; returns what came before.
    async fn until_closed(&mut self) -> Vec<Value> {
        let mut rest: Vec<Value> = self.notes.drain(..).collect();
        while let Some(m) = self.recv().await {
            rest.push(m);
        }
        rest
    }

    async fn half_close(&mut self) {
        self.wr.take().unwrap().shutdown().await.unwrap();
    }
}

fn scope(s: &str, required: bool) -> Value {
    json!({ "scope": s, "required": required, "reason": format!("Needs {s}") })
}

fn registration(app_id: &str, scopes: Vec<Value>) -> Value {
    json!({
        "appId": app_id, "name": "Test bar", "description": "Shows the current song.", "publisher": "Example",
        "scopes": scopes, "apiVersion": "1.0",
    })
}

fn hello(app_id: &str, token: &str) -> Value {
    json!({ "appId": app_id, "token": token, "apiVersion": "1.0" })
}

fn code(e: &Value) -> i64 {
    e["code"].as_i64().unwrap()
}

/// Registers an app with these scopes, all required, and returns its token.
async fn register(env: &Env, app_id: &str, scopes: &[&str]) -> String {
    let mut c = Client::connect(&env.socket).await;
    let r = c.ok("app.register", registration(app_id, scopes.iter().map(|s| scope(s, true)).collect())).await;
    env.server.resolve(r["requestId"].as_str().unwrap(), Decision::Allow, &[]).unwrap();
    c.note("registration.resolved").await["token"].as_str().unwrap().to_string()
}

/// A client the server takes for another program (over a socket pair, since the real peer is always this test).
fn as_program(env: &Env, exe: &str) -> Client {
    let identity = AppIdentity {
        kind: Kind::Executable,
        key: format!("exe:{exe}"),
        executable: exe.into(),
        interpreter: None,
        script: None,
        app_image: None,
        flatpak_id: None,
    };
    let (ours, theirs) = UnixStream::pair().unwrap();
    tokio::spawn(env.server.clone().serve_as(theirs, Some(identity), std::future::pending()));
    Client::over(ours)
}

async fn session(env: &Env, app_id: &str, token: &str) -> Client {
    let mut c = Client::connect(&env.socket).await;
    c.ok("session.hello", hello(app_id, token)).await;
    c
}

#[tokio::test]
async fn register_consent_and_hello() {
    let env = start("register").await;
    let mut c = Client::connect(&env.socket).await;
    let scopes = vec![scope("player:read", true), scope("queue:read", false), scope("lyrics:read", false)];
    let r = c.ok("app.register", registration("com.example.bar", scopes)).await;
    assert_eq!(r["status"], "pending");
    // The real peer: this test binary, identified by its executable.
    assert_eq!(r["identity"]["kind"], "executable");
    let rid = r["requestId"].as_str().unwrap().to_string();
    assert_eq!(*env.host.notified.lock().unwrap(), vec![rid.clone()]);
    let consent = env.host.wait_for("api:consent", |v| v["requestId"] == rid).await;
    assert_eq!(consent["kind"], "register");
    assert_eq!(consent["scopes"][0]["label"], "See what's playing");
    assert_eq!(consent["alreadyRegistered"], false);

    // The user leaves one optional scope ticked.
    env.server.resolve(&rid, Decision::Allow, &["lyrics:read".into()]).unwrap();
    let out = c.note("registration.resolved").await;
    assert_eq!((out["status"].as_str(), out["kind"].as_str()), (Some("approved"), Some("register")));
    assert_eq!(out["grantedScopes"], json!(["player:read", "lyrics:read"]));
    let token = out["token"].as_str().unwrap().to_string();
    assert!(token.starts_with("snl_"));
    let stored = std::fs::read_to_string(env.dir.join("api-apps.json")).unwrap();
    assert!(!stored.contains(&token), "the token must be stored hashed");

    let mut s = Client::connect(&env.socket).await;
    let h = s.ok("session.hello", hello("com.example.bar", &token)).await;
    assert_eq!(h["grantedScopes"], json!(["player:read", "lyrics:read"]));
    assert_eq!(h["appVersion"], "9.9.9");
    assert_eq!(s.err("session.hello", hello("com.example.bar", &token)).await["data"]["reason"], "alreadyAuthenticated");
    let info = s.ok("app.info", json!({})).await;
    assert_eq!(info["session"]["appId"], "com.example.bar");

    let mut bad = Client::connect(&env.socket).await;
    assert_eq!(code(&bad.err("session.hello", hello("com.example.bar", "snl_wrong")).await), -32002);
    assert_eq!(code(&bad.err("session.hello", hello("com.example.other", &token)).await), -32001);
    assert_eq!(code(&bad.err("player.getState", json!({})).await), -32012);
    assert_eq!(code(&bad.err("session.hello", json!({ "appId": "com.example.bar", "token": token, "apiVersion": "2.0" })).await), -32013);
    let unknown = bad.err("app.register", json!({ "appId": "com.example.x", "bogus": 1 })).await;
    assert_eq!((code(&unknown), unknown["data"]["reason"].as_str()), (-32602, Some("unknownParam")));
    let apps = env.server.apps();
    assert_eq!(apps["apps"][0]["connections"], 1);
}

#[tokio::test]
async fn deny_cooldown_block_and_unblock() {
    let env = start("deny").await;
    let mut c = Client::connect(&env.socket).await;
    let r = c.ok("app.register", registration("com.example.denied", vec![scope("search", true)])).await;
    // A second request while one waits points at the first.
    let mut c2 = Client::connect(&env.socket).await;
    let dup = c2.err("app.register", registration("com.example.denied", vec![scope("search", true)])).await;
    assert_eq!((code(&dup), &dup["data"]["requestId"]), (-32004, &r["requestId"]));

    env.server.resolve(r["requestId"].as_str().unwrap(), Decision::Deny, &[]).unwrap();
    let out = c.note("registration.resolved").await;
    assert_eq!((out["status"].as_str(), out["retryAfterMs"].as_u64()), (Some("denied"), Some(600_000)));
    assert!(out["token"].is_null());
    let again = c.err("app.register", registration("com.example.denied", vec![scope("search", true)])).await;
    assert_eq!(code(&again), -32005);
    assert!(again["data"]["retryAfterMs"].as_u64().unwrap() > 590_000);

    // Denials hold back the whole program too, so the next app runs as another one.
    let mut b = as_program(&env, "/opt/other/app");
    let r = b.ok("app.register", registration("com.example.blocked", vec![scope("search", true)])).await;
    env.server.resolve(r["requestId"].as_str().unwrap(), Decision::Block, &[]).unwrap();
    assert_eq!(b.note("registration.resolved").await["status"], "blocked");
    assert_eq!(code(&b.err("app.register", registration("com.example.blocked", vec![scope("search", true)])).await), -32006);
    assert_eq!(env.server.apps()["blocked"][0]["appId"], "com.example.blocked");

    env.server.unblock("com.example.blocked");
    let r = b.ok("app.register", registration("com.example.blocked", vec![scope("search", true)])).await;
    assert_eq!(r["status"], "pending");
}

#[tokio::test]
async fn scopes_are_enforced_and_can_grow() {
    let env = start("scopes").await;
    let token = register(&env, "com.example.scoped", &["player:read"]).await;
    let mut s = session(&env, "com.example.scoped", &token).await;

    let denied = s.err("player.play", json!({})).await;
    assert_eq!((code(&denied), denied["data"]["scope"].as_str()), (-32003, Some("player:control")));
    assert_eq!(s.err("events.subscribe", json!({ "topics": ["queue"] })).await["data"]["scope"], "queue:read");
    assert_eq!(s.err("player.getState", json!({})).await["data"]["reason"], "starting");

    let state = json!({
        "status": "paused", "item": { "type": "track", "id": "abc", "title": "Song", "rating": "like" }, "positionMs": 1000,
        "positionAt": 0, "durationMs": 200_000, "volume": 50, "muted": false, "rate": 1,
    });
    env.server.publish("player", state);
    let got = s.ok("player.getState", json!({})).await;
    assert_eq!(got["positionMs"], 1000);
    assert!(got["item"]["rating"].is_null(), "no library:read, no rating");
    let sub = s.ok("events.subscribe", json!({ "topics": ["player.state", "account"] })).await;
    assert_eq!(sub["topics"], json!(["player.state", "account"]));
    let snap = s.note("player.stateChanged").await;
    assert_eq!((snap["item"]["id"].as_str(), snap["item"]["rating"].is_null()), (Some("abc"), true));
    assert_eq!(s.note("account.changed").await["signedIn"], false);

    // More access, asked for on the open session.
    let r = s.ok("app.requestScopes", json!({ "scopes": [scope("player:control", true)] })).await;
    assert_eq!(r["status"], "pending");
    env.server.resolve(r["requestId"].as_str().unwrap(), Decision::Allow, &[]).unwrap();
    let out = s.note("registration.resolved").await;
    assert_eq!((out["kind"].as_str(), out["token"].is_null()), (Some("scopes"), true));
    let changed = s.note("session.scopesChanged").await;
    assert_eq!(changed["added"], json!(["player:control"]));
    assert_eq!(changed["grantedScopes"], json!(["player:read", "player:control"]));
    let again = s.ok("app.requestScopes", json!({ "scopes": [scope("player:control", true)] })).await;
    assert_eq!(again["status"], "granted");

    // Frontend methods go over the bridge once the frontend is listening.
    assert_eq!(s.err("player.play", json!({})).await["data"]["reason"], "starting");
    let (tx, mut rx) = mpsc::unbounded_channel();
    *env.host.calls.lock().unwrap() = Some(tx);
    env.server.frontend_ready(true);
    let server = env.server.clone();
    tokio::spawn(async move {
        while let Some(call) = rx.recv().await {
            let id = call["id"].as_u64().unwrap();
            if call["method"] == "player.seek" {
                server.bridge_reply(id, None, Some(json!({ "name": "Unavailable", "reason": "nothingPlaying" })));
            } else {
                assert_eq!(call["appId"], "com.example.scoped");
                assert_eq!(call["scopes"], json!(["player:read", "player:control"]));
                server.bridge_reply(id, Some(json!({})), None);
            }
        }
    });
    assert_eq!(s.ok("player.play", json!({})).await, json!({}));
    let e = s.err("player.seek", json!({ "positionMs": 5 })).await;
    assert_eq!((code(&e), e["data"]["reason"].as_str()), (-32010, Some("nothingPlaying")));
    assert_eq!(code(&s.err("player.fly", json!({})).await), -32601);
}

#[tokio::test]
async fn revoke_scope_remove_and_unregister() {
    let env = start("revoke").await;
    let token = register(&env, "com.example.removed", &["player:read", "queue:read"]).await;
    let mut a = session(&env, "com.example.removed", &token).await;
    let mut b = session(&env, "com.example.removed", &token).await;
    a.ok("events.subscribe", json!({ "topics": ["queue"] })).await;

    env.server.revoke_scope("com.example.removed", "queue:read");
    for c in [&mut a, &mut b] {
        let n = c.note("session.scopesChanged").await;
        assert_eq!((n["removed"].clone(), n["grantedScopes"].clone()), (json!(["queue:read"]), json!(["player:read"])));
    }
    assert_eq!(code(&a.err("queue.get", json!({})).await), -32003);

    env.server.remove_app("com.example.removed");
    for c in [&mut a, &mut b] {
        let rest = c.until_closed().await;
        assert!(rest.iter().any(|m| m["method"] == "session.revoked" && m["params"]["reason"] == "removed"), "{rest:?}");
    }
    let mut late = Client::connect(&env.socket).await;
    assert_eq!(code(&late.err("session.hello", hello("com.example.removed", &token)).await), -32001);

    // The app disconnects itself: this connection gets the answer, the other one is told.
    let token = register(&env, "com.example.leaving", &["player:read"]).await;
    let mut a = session(&env, "com.example.leaving", &token).await;
    let mut b = session(&env, "com.example.leaving", &token).await;
    assert_eq!(a.ok("app.unregister", json!({})).await, json!({}));
    assert!(a.until_closed().await.is_empty());
    assert_eq!(b.note("session.revoked").await["reason"], "unregistered");
    assert!(env.host.emitted("api:toast").iter().any(|t| t["message"] == "Test bar disconnected from Sonolith"));

    // Blocking a registered app revokes it and turns it away for good.
    let token = register(&env, "com.example.blockme", &["player:read"]).await;
    let mut c = session(&env, "com.example.blockme", &token).await;
    env.server.block_app("com.example.blockme");
    assert_eq!(c.note("session.revoked").await["reason"], "blocked");
    let mut late = Client::connect(&env.socket).await;
    assert_eq!(code(&late.err("session.hello", hello("com.example.blockme", &token)).await), -32006);
}

#[tokio::test]
async fn blocking_a_program_that_asks_under_a_registered_id_spares_the_registered_app() {
    let env = start("impostor").await;
    let token = register(&env, "com.example.real", &["player:read"]).await;
    let mut real = session(&env, "com.example.real", &token).await;
    // Another program asks under the same app id; the user sees both programs and blocks the newcomer.
    let mut evil = as_program(&env, "/tmp/evil/bar");
    let r = evil.ok("app.register", registration("com.example.real", vec![scope("library:read", true)])).await;
    let rid = r["requestId"].as_str().unwrap().to_string();
    let consent = env.host.wait_for("api:consent", |v| v["requestId"] == rid).await;
    assert_eq!((consent["alreadyRegistered"].as_bool(), consent["previousIdentity"]["kind"].as_str()), (Some(true), Some("executable")));
    env.server.resolve(&rid, Decision::Block, &[]).unwrap();
    assert_eq!(evil.note("registration.resolved").await["status"], "blocked");
    // The real app goes on, now and on its next connection.
    assert_eq!(real.ok("app.info", json!({})).await["session"]["appId"], "com.example.real");
    session(&env, "com.example.real", &token).await;
    // The blocked program is turned away under any app id.
    assert_eq!(code(&evil.err("app.register", registration("com.example.real", vec![scope("search", true)])).await), -32006);
    assert_eq!(code(&evil.err("app.register", registration("com.example.other", vec![scope("search", true)])).await), -32006);
}

#[tokio::test]
async fn blocking_the_registered_program_itself_ends_its_sessions() {
    let env = start("blockself").await;
    let token = register(&env, "com.example.self", &["player:read"]).await;
    let mut s = session(&env, "com.example.self", &token).await;
    // The same program asks again (same identity); the user blocks it.
    let mut c = Client::connect(&env.socket).await;
    let r = c.ok("app.register", registration("com.example.self", vec![scope("search", true)])).await;
    env.server.resolve(r["requestId"].as_str().unwrap(), Decision::Block, &[]).unwrap();
    assert_eq!(s.note("session.revoked").await["reason"], "blocked");
    assert!(env.server.apps()["apps"].as_array().unwrap().is_empty());
    let mut late = Client::connect(&env.socket).await;
    assert_eq!(code(&late.err("session.hello", hello("com.example.self", &token)).await), -32006);
}

#[tokio::test]
async fn identity_change_asks_again() {
    let env = start("identity").await;
    let token = register(&env, "com.example.moved", &["player:read"]).await;
    // The same app from another place on disk.
    let mut c = as_program(&env, "/opt/moved/bar");
    let e = c.err("session.hello", hello("com.example.moved", &token)).await;
    assert_eq!((code(&e), e["data"]["reason"].as_str()), (-32004, Some("identityChanged")));
    let rid = e["data"]["requestId"].as_str().unwrap().to_string();
    let consent = env.host.wait_for("api:consent", |v| v["requestId"] == rid).await;
    assert_eq!(consent["kind"], "identity");
    assert_eq!(consent["previousIdentity"]["kind"], "executable");

    env.server.resolve(&rid, Decision::Allow, &[]).unwrap();
    let out = c.note("registration.resolved").await;
    assert_eq!((out["kind"].as_str(), out["grantedScopes"].clone()), (Some("identity"), json!(["player:read"])));
    let h = c.ok("session.hello", hello("com.example.moved", &token)).await;
    assert_eq!(h["identity"]["key"], "exe:/opt/moved/bar");
}

#[tokio::test]
async fn closing_cancels_pending_and_half_close_still_delivers() {
    let env = start("close").await;
    let mut c = Client::connect(&env.socket).await;
    let r = c.ok("app.register", registration("com.example.gone", vec![scope("search", true)])).await;
    let rid = r["requestId"].as_str().unwrap().to_string();
    drop(c);
    env.host.wait_for("api:consent-cancel", |v| v["requestId"] == rid).await;
    assert!(env.server.resolve(&rid, Decision::Allow, &[]).is_err());

    // A shell pipe: the request, then EOF; the outcome still arrives before the server closes.
    let mut c = Client::connect(&env.socket).await;
    let id = c.send("app.register", registration("com.example.pipe", vec![scope("search", true)])).await;
    c.half_close().await;
    let r = c.recv().await.unwrap();
    assert_eq!(r["id"], id);
    env.server.resolve(r["result"]["requestId"].as_str().unwrap(), Decision::Allow, &[]).unwrap();
    let rest = c.until_closed().await;
    assert_eq!(rest.len(), 1);
    assert_eq!(rest[0]["params"]["status"], "approved");
}

/// Requests whose answers are big (the id comes back), sent without reading any of them.
async fn flood(c: &mut Client, count: usize) {
    let id = "x".repeat(600 * 1024);
    for _ in 0..count {
        let mut line = json!({ "jsonrpc": "2.0", "id": id, "method": "nope.nope" }).to_string();
        line.push('\n');
        if c.wr.as_mut().unwrap().write_all(line.as_bytes()).await.is_err() {
            return;
        }
    }
}

async fn wait_for_connections(env: &Env, n: usize) {
    for _ in 0..300 {
        if env.server.connection_count() == n {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("{} connections, expected {n}", env.server.connection_count());
}

#[tokio::test]
async fn a_client_that_never_reads_is_cut_off() {
    let env = start("noread").await;
    let mut c = Client::connect(&env.socket).await;
    // More than 4 MiB of answers pile up: the connection ends, though the writer is stuck on the full socket.
    flood(&mut c, 9).await;
    wait_for_connections(&env, 0).await;
}

#[tokio::test]
async fn turning_the_api_off_ends_sessions_of_clients_that_never_read() {
    let env = start("off").await;
    let token = register(&env, "com.example.stuck", &["player:control"]).await;
    let mut c = session(&env, "com.example.stuck", &token).await;
    let (tx, mut rx) = mpsc::unbounded_channel();
    *env.host.calls.lock().unwrap() = Some(tx);
    env.server.frontend_ready(true);
    // Below the backlog limit, but far more than the socket holds: the writer waits for a reader that never comes.
    flood(&mut c, 3).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    env.server.close_all();
    wait_for_connections(&env, 0).await;
    // Nothing it sends afterwards reaches the frontend (the write itself may fail: the socket is gone).
    let _ = c.wr.as_mut().unwrap().write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"player.play\"}\n").await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(rx.try_recv().is_err());
}

#[tokio::test]
async fn closing_cancels_frontend_work_in_flight() {
    let env = start("cancel").await;
    let token = register(&env, "com.example.busy", &["queue:write"]).await;
    let mut c = session(&env, "com.example.busy", &token).await;
    let (tx, mut rx) = mpsc::unbounded_channel();
    *env.host.calls.lock().unwrap() = Some(tx);
    env.server.frontend_ready(true);
    // The frontend gets the call and never answers; the app goes away meanwhile.
    c.send("queue.add", json!({ "items": [{ "type": "playlist", "id": "PL1" }] })).await;
    let call = tokio::time::timeout(WAIT, rx.recv()).await.unwrap().unwrap();
    drop(c);
    let id = call["id"].clone();
    env.host.wait_for("api:cancel", |v| v["id"] == id).await;
}

#[tokio::test]
async fn a_peer_that_cannot_be_looked_up_holds_up_nobody() {
    let env = start("slowpeer").await;
    // A lookup stuck like a stat on a hung FUSE mount, until the test ends.
    let (release, stuck) = std::sync::mpsc::channel::<()>();
    let (ours, theirs) = UnixStream::pair().unwrap();
    let peer = move || {
        let _ = stuck.recv();
        Err(super::peer::PeerError::Unknown)
    };
    tokio::spawn(env.server.clone().serve(theirs, peer, std::future::pending()));
    // Others are served meanwhile (this runtime has one thread: a blocking lookup on it would stop everything).
    let mut other = Client::connect(&env.socket).await;
    assert_eq!(other.ok("app.info", json!({})).await["appVersion"], "9.9.9");
    // The stuck one gets an answer too, as a peer that couldn't be verified.
    let mut c = Client::over(ours);
    let e = c.err("app.register", registration("com.example.slow", vec![scope("search", true)])).await;
    assert_eq!((code(&e), e["data"]["reason"].as_str()), (-32010, Some("peerUnverified")));
    drop(release);
}

#[tokio::test]
async fn texts_for_the_consent_screen_cannot_carry_control_or_direction_characters() {
    let env = start("texts").await;
    let base = registration("com.example.texts", vec![scope("search", true)]);
    let with = |key: &str, value: &str| {
        let mut r = base.clone();
        r[key] = json!(value);
        r
    };
    for (params, path) in [
        (with("name", "Firefox\u{202E}rab"), "/name"),
        (with("name", "Bar\nSonolith says: safe"), "/name"),
        (with("description", "Shows\u{200B}songs"), "/description"),
        (with("publisher", "Example\u{7}"), "/publisher"),
        (with("publisher", "Ex\u{2066}ample"), "/publisher"),
    ] {
        // A connection each: `auth` allows five calls in a row.
        let e = Client::connect(&env.socket).await.err("app.register", params).await;
        assert_eq!((code(&e), e["data"]["path"].as_str()), (-32602, Some(path)));
    }
    let mut r = base.clone();
    r["scopes"][0]["reason"] = json!("To show\u{2028}more");
    let mut c = Client::connect(&env.socket).await;
    assert_eq!(c.err("app.register", r).await["data"]["path"], "/scopes/0");
    // Ordinary text in any script is fine.
    assert_eq!(c.ok("app.register", with("name", "Přehrávač – Ünïcödé 音楽")).await["status"], "pending");
}

#[tokio::test]
async fn malformed_lines_keep_the_connection() {
    let env = start("framing").await;
    let mut c = Client::connect(&env.socket).await;
    c.wr.as_mut().unwrap().write_all(b"not json\n[1,2]\n").await.unwrap();
    assert_eq!(code(&c.recv().await.unwrap()["error"]), -32700);
    assert_eq!(code(&c.recv().await.unwrap()["error"]), -32600);
    let info = c.ok("app.info", json!({})).await;
    assert!(info["session"].is_null());
    assert!(info["methods"].as_array().unwrap().iter().any(|m| m == "queue.clear"));
}

#[tokio::test]
async fn endpoint_writes_discovery_and_cleans_up() {
    use std::os::unix::fs::PermissionsExt;
    let base = temp_dir("endpoint");
    // The only test that touches the variable; `start` reads it once.
    std::env::set_var("XDG_RUNTIME_DIR", &base);
    let host = Arc::new(FakeHost::default());
    let server = Server::new(host, base.join("api-apps.json"), "9.9.9".into());
    let (endpoint, task) = super::transport::start(server.clone(), "9.9.9").await.unwrap();
    let dir = base.join("sonolith");
    assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
    let socket = dir.join("api.sock");
    assert_eq!(std::fs::metadata(&socket).unwrap().permissions().mode() & 0o777, 0o600);
    let d: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("discovery.json")).unwrap()).unwrap();
    assert_eq!((d["transport"].as_str(), d["path"].as_str(), d["pid"].as_u64()), (Some("unix"), Some(endpoint.path.as_str()), Some(std::process::id() as u64)));
    assert_eq!(d["apiVersion"], super::protocol::API_VERSION);

    let mut c = Client::connect(&socket).await;
    assert_eq!(c.ok("app.info", json!({})).await["appVersion"], "9.9.9");
    assert!(super::transport::start(server, "9.9.9").await.is_err(), "a live socket is not taken over");

    task.abort();
    endpoint.cleanup();
    assert!(!socket.exists() && !dir.join("discovery.json").exists());
    let _ = std::fs::remove_dir_all(&base);
}

// ---------------------------------------------------------------- a live server for the example clients

/// Approves (or denies, `SONOLITH_TEST_CONSENT=deny`) every consent request after a moment, like a user clicking.
#[derive(Default)]
struct AutoHost {
    server: std::sync::OnceLock<Arc<Server>>,
}

impl Host for AutoHost {
    fn emit(&self, event: &str, payload: Value) {
        if event != "api:consent" {
            return;
        }
        let Some(server) = self.server.get().cloned() else { return };
        let rid = payload["requestId"].as_str().unwrap_or("").to_string();
        let decision = if std::env::var("SONOLITH_TEST_CONSENT").as_deref() == Ok("deny") { Decision::Deny } else { Decision::Allow };
        let scopes: Vec<String> = payload["scopes"].as_array().into_iter().flatten().filter_map(|s| s["scope"].as_str().map(String::from)).collect();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(400)).await;
            let _ = server.resolve(&rid, decision, &scopes);
        });
    }
    fn notify(&self, _request_id: &str, _title: &str, _body: &str) {}
    fn close_notification(&self, _request_id: &str) {}
}

fn demo_track(id: &str, title: &str) -> Value {
    json!({
        "type": "track", "id": id, "title": title, "artists": [{ "id": "UCdemo", "name": "Demo Band" }], "album": null, "durationMs": 20_000,
        "thumbnailUrl": null, "explicit": false, "video": false, "rating": null,
    })
}

/// Serves like Sonolith with a fake frontend, until `$SONOLITH_TEST_DIR/stop` exists:
/// `SONOLITH_TEST_DIR=/tmp/snl cargo test --lib api::tests::live_server_for_examples -- --ignored --nocapture`,
/// then point a client at it with `XDG_RUNTIME_DIR=/tmp/snl`. Every 4 seconds the track changes; `touch /tmp/snl/remove`
/// removes all apps, `touch /tmp/snl/stop` ends it. `SONOLITH_TEST_CONSENT=deny` denies instead of allowing.
#[tokio::test]
#[ignore]
async fn live_server_for_examples() {
    let base = PathBuf::from(std::env::var("SONOLITH_TEST_DIR").expect("SONOLITH_TEST_DIR"));
    std::fs::create_dir_all(&base).unwrap();
    std::env::set_var("XDG_RUNTIME_DIR", &base);
    let host = Arc::new(AutoHost::default());
    let server = Server::new(host.clone(), base.join("api-apps.json"), "9.9.9".into());
    host.server.set(server.clone()).ok();
    let (endpoint, task) = super::transport::start(server.clone(), "9.9.9").await.unwrap();
    println!("listening on {}", endpoint.path);
    server.frontend_ready(true);
    let lyrics = |id: &str| {
        let lines: Vec<Value> = (0..8)
            .map(|i| json!({ "startMs": i * 2000, "endMs": i * 2000 + 1800, "text": format!("Line {i}"), "words": [], "background": [] }))
            .collect();
        json!({ "trackId": id, "status": "found", "lyrics": { "trackId": id, "tier": "line", "provider": "lrclib", "providerName": "LRCLIB", "attribution": null, "lines": lines } })
    };
    server.publish("account", json!({ "signedIn": true }));
    let mut n = 0u32;
    while !base.join("stop").exists() {
        let (id, title) = if n % 2 == 0 { ("trackA", "First song") } else { ("trackB", "Second song") };
        let now = super::server::now_ms();
        server.publish("player", json!({
            "status": "playing", "item": demo_track(id, title), "positionMs": 0, "positionAt": now, "durationMs": 20_000, "volume": 50,
            "muted": false, "shuffle": false, "repeat": "off", "rate": 1, "episodeRate": 1, "canGoNext": true, "canGoPrevious": true,
            "queueIndex": 0, "queueLength": 2, "autoplay": true,
        }));
        server.publish("lyrics", lyrics(id));
        n += 1;
        for _ in 0..40 {
            if base.join("stop").exists() {
                break;
            }
            // `touch remove`: the user removes every app in Settings.
            if std::fs::remove_file(base.join("remove")).is_ok() {
                server.remove_all();
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    task.abort();
    endpoint.cleanup();
}
