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
