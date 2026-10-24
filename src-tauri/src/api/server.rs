//! The API server: connections, registration and consent, sessions, scopes, rate limits, subscriptions, and the
//! bridge to the frontend. Transport-independent: `serve` takes any byte stream plus the peer's process facts.
//!
//! Nothing here blocks: state sits behind short std mutexes that are never held across an await, every connection
//! has its own tasks, and a misbehaving client only ever loses its own connection.

use super::identity::{self, AppIdentity, ProcessInfo};
use super::methods::{self, Buckets, Handler};
use super::peer::PeerError;
use super::protocol::{self, Code, Line, Request, RpcError};
use super::store::{self, AppRecord, Registry};
use super::validate;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, watch};

const PENDING_TTL_MS: u64 = 5 * store::MINUTE;
const MAX_PENDING: usize = 3;
const MAX_IN_FLIGHT: usize = 16;
const MAX_APP_CONNECTIONS: usize = 8;
pub const MAX_CONNECTIONS: usize = 64;
const AUTH_TIMEOUT: Duration = Duration::from_secs(30);
/// How long working out who connected may take; a slower peer stays unverified.
const PEER_TIMEOUT: Duration = Duration::from_secs(2);
/// Identity lookups at once. One stuck for good (a hung FUSE mount) keeps its slot, so this also caps the blocking
/// threads a client can tie up; with every slot stuck, new peers are unverified but the app goes on.
const IDENTITY_SLOTS: usize = 8;
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_QUEUED: usize = 4 * 1024 * 1024;
/// A write that makes no progress for this long means the client stopped reading: the connection ends.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
/// Above this much unsent data, droppable events (position, lyric words) are skipped.
const DROP_ABOVE: usize = 64 * 1024;
const COALESCE: Duration = Duration::from_millis(100);
const ACTIVITY_LEN: usize = 50;

/// What the server needs from the app around it (the Tauri app, or a fake in tests).
pub trait Host: Send + Sync + 'static {
    /// An event to the frontend.
    fn emit(&self, event: &str, payload: Value);
    /// A system notification for a consent request; clicking it shows Sonolith.
    fn notify(&self, request_id: &str, title: &str, body: &str);
    fn close_notification(&self, request_id: &str);
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Register,
    Scopes,
    Identity,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Register => "register",
            Kind::Scopes => "scopes",
            Kind::Identity => "identity",
        }
    }
}

struct Pending {
    conn: u64,
    kind: Kind,
    app_id: String,
    identity: AppIdentity,
    /// `app.register` params (name, publisher, …), for the record.
    details: Map<String, Value>,
    /// Requested scopes: (scope, required, reason).
    scopes: Vec<(String, bool, String)>,
    expires_at: u64,
}

enum Out {
    Line(String),
    Close,
}

struct Conn {
    tx: mpsc::UnboundedSender<Out>,
    /// Set to end the connection at once: reader and writer stop and the stream is dropped, queued data or not.
    kill: watch::Sender<bool>,
    queued: Arc<AtomicUsize>,
    identity: Option<AppIdentity>,
    app_id: Option<String>,
    scopes: Vec<String>,
    topics: HashSet<String>,
    position_hz: u64,
    /// Bumped to stop this connection's position task.
    position_gen: u64,
    in_flight: usize,
    /// Topics whose snapshots go out right after the `events.subscribe` response.
    snapshots_due: Vec<String>,
    half_closed: bool,
    closing: bool,
    /// When the connection last started its time to authenticate: on connecting, and when its registration ended.
    idle_since: Instant,
}

#[derive(Default)]
struct Published {
    player: Option<Value>,
    queue: Option<Value>,
    signed_in: Option<bool>,
    lyrics: Option<Value>,
}

#[derive(Default)]
struct Coalesce {
    last: Option<Instant>,
    pending: Option<(String, Value)>,
    scheduled: bool,
}

pub struct Server {
    host: Arc<dyn Host>,
    registry_path: PathBuf,
    registry: Mutex<Registry>,
    /// What went wrong reading the saved registry at startup, shown in Settings.
    registry_problem: Option<String>,
    conns: Mutex<HashMap<u64, Conn>>,
    pending: Mutex<HashMap<String, Pending>>,
    /// Calls waiting for the frontend: the connection they came from, and where the answer goes.
    bridge: Mutex<HashMap<u64, (u64, oneshot::Sender<Result<Value, RpcError>>)>>,
    buckets: Mutex<HashMap<String, Buckets>>,
    activity: Mutex<HashMap<String, VecDeque<(String, u64)>>>,
    published: Mutex<Published>,
    coalesce: Mutex<HashMap<&'static str, Coalesce>>,
    /// Bumped whenever the player state changes; wakes the lyrics clock.
    clock: watch::Sender<u64>,
    lyrics_wanted: AtomicBool,
    frontend_ready: AtomicBool,
    next_id: AtomicU64,
    identity_slots: Arc<tokio::sync::Semaphore>,
    /// `AUTH_TIMEOUT` in ms; tests shorten it.
    auth_timeout_ms: AtomicU64,
    app_version: String,
    platform: &'static str,
}

impl Server {
    pub fn new(host: Arc<dyn Host>, registry_path: PathBuf, app_version: String) -> Arc<Server> {
        let (registry, registry_problem) = Registry::load(&registry_path);
        let server = Arc::new(Server {
            host,
            registry_path,
            registry: Mutex::new(registry),
            registry_problem,
            conns: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
            bridge: Mutex::new(HashMap::new()),
            buckets: Mutex::new(HashMap::new()),
            activity: Mutex::new(HashMap::new()),
            published: Mutex::new(Published::default()),
            coalesce: Mutex::new(HashMap::new()),
            clock: watch::channel(0).0,
            lyrics_wanted: AtomicBool::new(false),
            frontend_ready: AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            identity_slots: Arc::new(tokio::sync::Semaphore::new(IDENTITY_SLOTS)),
            auth_timeout_ms: AtomicU64::new(AUTH_TIMEOUT.as_millis() as u64),
            app_version,
            platform: if cfg!(windows) { "windows" } else { "linux" },
        });
        tokio::spawn(lyrics_clock(Arc::downgrade(&server), server.clock.subscribe()));
        server
    }

    fn id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn connection_count(&self) -> usize {
        self.conns.lock().unwrap().len()
    }

    #[cfg(test)]
    pub fn set_auth_timeout(&self, d: Duration) {
        self.auth_timeout_ms.store(d.as_millis() as u64, Ordering::Relaxed);
    }

    fn auth_timeout(&self) -> Duration {
        Duration::from_millis(self.auth_timeout_ms.load(Ordering::Relaxed))
    }

    #[cfg(test)]
    pub fn rate_bucket_count(&self) -> usize {
        self.buckets.lock().unwrap().len()
    }

    // ------------------------------------------------------------ connections

    /// Serves one connection until it closes. `peer` asks the OS about the other end (blocking work). `hangup`
    /// resolves once the client is gone for good; it is only awaited after the client stopped sending, because end
    /// of input alone may be a half-close (a shell pipe) that still waits for answers.
    pub async fn serve<S, H, P>(self: Arc<Self>, stream: S, peer: P, hangup: H)
    where
        S: AsyncRead + AsyncWrite + Send + 'static,
        H: std::future::Future<Output = ()> + Send,
        P: FnOnce() -> Result<ProcessInfo, PeerError> + Send + 'static,
    {
        if self.connection_count() >= MAX_CONNECTIONS {
            return;
        }
        let identity = self.identify(peer).await;
        self.serve_as(stream, identity, hangup).await
    }

    /// The peer's app identity, worked out on a blocking thread: /proc reads and `canonicalize` / `is_file` on paths
    /// from the client's command line can hang. None (`peerUnverified`) when it fails or takes over `PEER_TIMEOUT`.
    async fn identify<P>(&self, peer: P) -> Option<AppIdentity>
    where
        P: FnOnce() -> Result<ProcessInfo, PeerError> + Send + 'static,
    {
        let slots = self.identity_slots.clone();
        let work = async move {
            let slot = slots.acquire_owned().await.ok()?;
            let derive = move || {
                let _slot = slot;
                peer().ok().map(|p| identity::derive(&p, cfg!(windows), &identity::RealFs))
            };
            tokio::task::spawn_blocking(derive).await.ok().flatten()
        };
        tokio::time::timeout(PEER_TIMEOUT, work).await.ok().flatten()
    }

    /// `serve` with the identity already derived (tests use this to act as any program).
    pub async fn serve_as<S, H>(self: Arc<Self>, stream: S, identity: Option<AppIdentity>, hangup: H)
    where
        S: AsyncRead + AsyncWrite + Send + 'static,
        H: std::future::Future<Output = ()> + Send,
    {
        let (rd, mut wr) = tokio::io::split(stream);
        let id = self.id();
        let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
        let (kill, mut reader_kill) = watch::channel(false);
        let mut writer_kill = kill.subscribe();
        let queued = Arc::new(AtomicUsize::new(0));
        self.conns.lock().unwrap().insert(
            id,
            Conn {
                tx,
                kill,
                queued: queued.clone(),
                identity,
                app_id: None,
                scopes: Vec::new(),
                topics: HashSet::new(),
                position_hz: 1,
                position_gen: 0,
                in_flight: 0,
                snapshots_due: Vec::new(),
                half_closed: false,
                closing: false,
                idle_since: Instant::now(),
            },
        );
        let (closed_tx, mut closed_rx) = watch::channel(false);
        tokio::pin!(hangup);

        // Writer: drains the queue; ends on Close, a write error or timeout, the kill switch, or when every sender is
        // gone. A client that stops reading fills the socket, so a write can wait forever without the timeout.
        let writer_queued = queued.clone();
        let writer = tokio::spawn(async move {
            loop {
                let out = tokio::select! {
                    out = rx.recv() => out,
                    _ = writer_kill.wait_for(|k| *k) => None,
                };
                match out {
                    Some(Out::Line(s)) => {
                        let ok = tokio::select! {
                            r = tokio::time::timeout(WRITE_TIMEOUT, wr.write_all(s.as_bytes())) => matches!(r, Ok(Ok(()))),
                            _ = writer_kill.wait_for(|k| *k) => false,
                        };
                        writer_queued.fetch_sub(s.len(), Ordering::Relaxed);
                        if !ok {
                            break;
                        }
                    }
                    Some(Out::Close) | None => break,
                }
            }
            let _ = tokio::time::timeout(Duration::from_secs(1), wr.shutdown()).await;
            let _ = closed_tx.send(true);
        });

        // Unauthenticated connections get 30 s, not counting the time a registration waits for the user: when it ends
        // (whatever the outcome), the 30 s start again.
        let weak = Arc::downgrade(&self);
        tokio::spawn(async move {
            loop {
                let wait = {
                    let Some(s) = weak.upgrade() else { return };
                    let timeout = s.auth_timeout();
                    let waiting = s.pending.lock().unwrap().values().any(|p| p.conn == id);
                    let due = match s.conns.lock().unwrap().get(&id) {
                        Some(c) if c.app_id.is_none() && !c.closing => c.idle_since + timeout,
                        _ => return,
                    };
                    let now = Instant::now();
                    if waiting {
                        timeout
                    } else if due > now {
                        due - now
                    } else {
                        s.close(id);
                        return;
                    }
                };
                tokio::time::sleep(wait).await;
            }
        });

        let mut reader = BufReader::with_capacity(64 * 1024, rd);
        let mut buf = Vec::new();
        loop {
            let line = tokio::select! {
                l = protocol::read_line(&mut reader, &mut buf) => l,
                _ = closed_rx.changed() => break,
                _ = reader_kill.wait_for(|k| *k) => break,
            };
            match line {
                Ok(Line::Message(m)) => {
                    if m.iter().all(|b| b.is_ascii_whitespace()) {
                        continue;
                    }
                    self.clone().on_message(id, &m).await;
                }
                Ok(Line::TooLarge) => {
                    self.send(id, protocol::error_response(&Value::Null, &RpcError::new(Code::InvalidRequest).reason("messageTooLarge")), false);
                    self.close(id);
                    break;
                }
                Ok(Line::Eof) => {
                    self.half_close(id);
                    tokio::select! {
                        _ = closed_rx.wait_for(|c| *c) => {}
                        _ = &mut hangup => {}
                    }
                    break;
                }
                Err(_) => break,
            }
        }
        self.close(id);
        let _ = writer.await;
        self.forget(id);
    }

    /// Queues a message. Droppable messages are skipped while the client lags; too much backlog closes it.
    fn send(&self, conn: u64, msg: Value, droppable: bool) {
        let conns = self.conns.lock().unwrap();
        if let Some(c) = conns.get(&conn) {
            self.send_to(c, &msg, droppable);
        }
    }

    fn send_to(&self, c: &Conn, msg: &Value, droppable: bool) {
        if c.closing {
            return;
        }
        let queued = c.queued.load(Ordering::Relaxed);
        if droppable && queued > DROP_ABOVE {
            return;
        }
        let mut line = msg.to_string();
        line.push('\n');
        if queued + line.len() > MAX_QUEUED {
            // Too far behind to catch up: a graceful close would only queue behind the backlog.
            c.kill.send_replace(true);
            return;
        }
        c.queued.fetch_add(line.len(), Ordering::Relaxed);
        let _ = c.tx.send(Out::Line(line));
    }

    /// Closes after everything queued so far is written.
    fn close(&self, conn: u64) {
        if let Some(c) = self.conns.lock().unwrap().get_mut(&conn) {
            if !c.closing {
                let _ = c.tx.send(Out::Close);
                c.closing = true;
            }
        }
    }

    /// Ends a connection at once, without sending what is still queued (the API is turned off).
    fn abort(&self, conn: u64) {
        if let Some(c) = self.conns.lock().unwrap().get_mut(&conn) {
            c.closing = true;
            c.kill.send_replace(true);
        }
    }

    /// The client closed its sending side: answer what is in flight, deliver a pending registration, then close.
    fn half_close(&self, conn: u64) {
        let lyrics_changed = {
            let mut conns = self.conns.lock().unwrap();
            let Some(c) = conns.get_mut(&conn) else { return };
            c.half_closed = true;
            c.position_gen += 1;
            let had_lyrics = c.topics.iter().any(|t| t.starts_with("lyrics"));
            c.topics.clear();
            had_lyrics
        };
        if lyrics_changed {
            self.update_lyrics_wanted();
        }
        self.maybe_finish(conn);
    }

    fn maybe_finish(&self, conn: u64) {
        let waiting = self.pending.lock().unwrap().values().any(|p| p.conn == conn);
        let done = self.conns.lock().unwrap().get(&conn).is_some_and(|c| c.half_closed && c.in_flight == 0);
        if done && !waiting {
            self.close(conn);
        }
    }

    /// Cleans up after a closed connection: its pending requests are cancelled.
    fn forget(&self, conn: u64) {
        let removed = self.conns.lock().unwrap().remove(&conn);
        // Per-connection buckets end with it; an app's own stay, so reconnecting doesn't refill them.
        self.buckets.lock().unwrap().remove(&format!("conn:{conn}"));
        // The frontend stops working on calls nobody waits for any more.
        let calls: Vec<u64> = {
            let mut bridge = self.bridge.lock().unwrap();
            let ids: Vec<u64> = bridge.iter().filter(|(_, (c, _))| *c == conn).map(|(id, _)| *id).collect();
            ids.into_iter().filter(|id| bridge.remove(id).is_some()).collect()
        };
        for id in calls {
            self.host.emit("api:cancel", json!({ "id": id }));
        }
        let cancelled: Vec<String> =
            self.pending.lock().unwrap().iter().filter(|(_, p)| p.conn == conn).map(|(k, _)| k.clone()).collect();
        for rid in cancelled {
            if self.pending.lock().unwrap().remove(&rid).is_some() {
                self.host.close_notification(&rid);
                self.host.emit("api:consent-cancel", json!({ "requestId": rid }));
            }
        }
        if removed.is_some_and(|c| c.topics.iter().any(|t| t.starts_with("lyrics"))) {
            self.update_lyrics_wanted();
        }
        self.emit_apps_changed();
    }

    // ------------------------------------------------------------ requests

    async fn on_message(self: Arc<Self>, conn: u64, line: &[u8]) {
        // Nothing more runs for a connection that is being closed (revoked, unregistered, the API turned off).
        if self.conns.lock().unwrap().get(&conn).is_none_or(|c| c.closing) {
            return;
        }
        let req = match protocol::parse(line) {
            Ok(r) => r,
            Err((id, e)) => return self.send(conn, protocol::error_response(&id, &e), false),
        };
        // Registration and authentication finish before the next message is read (SPEC.md 4.3).
        if matches!(req.method.as_str(), "session.hello" | "app.register") {
            let id = req.id.clone();
            let out = self.dispatch(conn, &req).await;
            return self.reply(conn, id, out);
        }
        {
            let mut conns = self.conns.lock().unwrap();
            let Some(c) = conns.get_mut(&conn) else { return };
            if c.in_flight >= MAX_IN_FLIGHT {
                drop(conns);
                let e = RpcError::new(Code::RateLimited).reason("tooManyInFlight").with("retryAfterMs", 100);
                return self.reply(conn, req.id, Err(e));
            }
            c.in_flight += 1;
        }
        tokio::spawn(async move {
            let out = self.dispatch(conn, &req).await;
            let after_unregister = req.method == "app.unregister" && out.is_ok();
            if let Some(c) = self.conns.lock().unwrap().get_mut(&conn) {
                c.in_flight -= 1;
            }
            self.reply(conn, req.id.clone(), out);
            let due = self.conns.lock().unwrap().get_mut(&conn).map(|c| std::mem::take(&mut c.snapshots_due)).unwrap_or_default();
            if !due.is_empty() {
                self.send_snapshots(conn, &due);
            }
            if after_unregister {
                self.close(conn);
            }
            self.maybe_finish(conn);
        });
    }

    fn reply(&self, conn: u64, id: Option<Value>, out: Result<Value, RpcError>) {
        let Some(id) = id else { return };
        let msg = match out {
            Ok(v) => protocol::response(&id, v),
            Err(e) => protocol::error_response(&id, &e),
        };
        self.send(conn, msg, false);
    }

    async fn dispatch(self: &Arc<Self>, conn: u64, req: &Request) -> Result<Value, RpcError> {
        let Some(m) = methods::find(&req.method) else {
            return Err(RpcError::new(Code::MethodNotFound));
        };
        let (app_id, scopes, identity) = {
            let conns = self.conns.lock().unwrap();
            let c = conns.get(&conn).ok_or_else(|| RpcError::new(Code::InternalError))?;
            (c.app_id.clone(), c.scopes.clone(), c.identity.clone())
        };
        if m.session && app_id.is_none() {
            return Err(RpcError::new(Code::SessionRequired));
        }
        if !m.scopes.is_empty() && !m.scopes.iter().any(|s| scopes.iter().any(|g| g == s)) {
            return Err(RpcError::new(Code::PermissionDenied).with("scope", m.scopes[0]));
        }
        // Rate limits: per app, except `auth`, which counts per connection (no app is known yet).
        let bucket_key = match (&app_id, m.rate) {
            (Some(a), r) if r != methods::Rate::Auth => a.clone(),
            _ => format!("conn:{conn}"),
        };
        if let Err(wait) = self.buckets.lock().unwrap().entry(bucket_key).or_default().take(m.rate, Instant::now()) {
            return Err(RpcError::new(Code::RateLimited).with("retryAfterMs", wait));
        }
        if let Some(a) = &app_id {
            self.log_activity(a, m.name);
        }
        let p = &req.params;
        match (m.handler, m.name) {
            (_, "app.info") => Ok(self.app_info(app_id.as_deref(), &scopes, identity.as_ref())),
            (_, "app.register") => self.register(conn, p, identity, app_id.is_some()),
            (_, "app.requestScopes") => self.request_scopes(conn, p, app_id.unwrap(), identity),
            (_, "app.unregister") => self.unregister(app_id.unwrap(), conn),
            (_, "session.hello") => self.hello(conn, p, identity, app_id.is_some()),
            (_, "events.subscribe") => self.subscribe(conn, p),
            (_, "events.unsubscribe") => self.unsubscribe(conn, p),
            (_, "player.getState") => self
                .player_state()
                .map(|s| for_scopes(s, &scopes))
                .ok_or_else(|| RpcError::new(Code::Unavailable).reason("starting").with("retryAfterMs", 1000)),
            (Handler::Frontend, name) => {
                validate::check(name, p)?;
                self.call_frontend(conn, name, p, app_id.as_deref().unwrap_or(""), &scopes).await
            }
            (Handler::Server, _) => Err(RpcError::new(Code::InternalError)),
        }
    }

    fn log_activity(&self, app_id: &str, method: &str) {
        let mut a = self.activity.lock().unwrap();
        let list = a.entry(app_id.to_string()).or_default();
        list.push_front((method.to_string(), now_ms()));
        list.truncate(ACTIVITY_LEN);
    }

    fn app_info(&self, app_id: Option<&str>, scopes: &[String], identity: Option<&AppIdentity>) -> Value {
        let session = app_id.map(|a| {
            json!({ "appId": a, "grantedScopes": scopes, "signedIn": self.signed_in(), "identity": identity })
        });
        json!({
            "apiVersion": protocol::API_VERSION,
            "appVersion": self.app_version,
            "platform": self.platform,
            "methods": methods::METHODS.iter().map(|m| m.name).collect::<Vec<_>>(),
            "topics": methods::TOPICS.iter().map(|(t, _)| *t).collect::<Vec<_>>(),
            "session": session,
        })
    }

    fn signed_in(&self) -> bool {
        self.published.lock().unwrap().signed_in.unwrap_or(false)
    }

    // ------------------------------------------------------------ registration

    fn register(&self, conn: u64, p: &Map<String, Value>, identity: Option<AppIdentity>, authed: bool) -> Result<Value, RpcError> {
        if authed {
            return Err(RpcError::new(Code::InvalidRequest).reason("alreadyAuthenticated"));
        }
        let v = Params::new(p, &["appId", "name", "description", "publisher", "homepage", "icon", "scopes", "apiVersion"])?;
        let app_id = v.app_id("appId")?;
        let name = v.plain("name", 1, 48)?;
        v.plain("description", 1, 200)?;
        v.plain("publisher", 1, 64)?;
        if let Some(h) = v.opt_text("homepage", 1, 200)? {
            if !h.starts_with("https://") || url::Url::parse(&h).is_err() {
                return Err(v.invalid("homepage"));
            }
        }
        if let Some(icon) = v.opt_text("icon", 1, 65536)? {
            if !valid_icon(&icon) {
                return Err(v.invalid("icon"));
            }
        }
        let scopes = v.scope_requests("scopes")?;
        v.version()?;
        let identity = identity.ok_or_else(|| RpcError::new(Code::Unavailable).reason("peerUnverified"))?;
        self.admit_request(&app_id, &identity)?;
        let mut details = p.clone();
        details.remove("scopes");
        details.remove("apiVersion");
        let pending = self.open_request(conn, Kind::Register, &app_id, identity.clone(), details, scopes)?;
        self.ask_user(&pending.0, &name, Kind::Register);
        Ok(json!({ "status": "pending", "requestId": pending.0, "expiresAt": pending.1, "identity": identity }))
    }

    /// Blocked apps and apps in a cooldown are turned away without asking the user.
    fn admit_request(&self, app_id: &str, identity: &AppIdentity) -> Result<(), RpcError> {
        let reg = self.registry.lock().unwrap();
        if reg.is_blocked(app_id, &identity.key) {
            return Err(RpcError::new(Code::Blocked));
        }
        if let Some(wait) = reg.cooldown(app_id, &identity.key, now_ms()) {
            return Err(RpcError::new(Code::RegistrationDenied).with("retryAfterMs", wait));
        }
        Ok(())
    }

    fn open_request(
        &self,
        conn: u64,
        kind: Kind,
        app_id: &str,
        identity: AppIdentity,
        details: Map<String, Value>,
        scopes: Vec<(String, bool, String)>,
    ) -> Result<(String, u64), RpcError> {
        let mut pending = self.pending.lock().unwrap();
        if let Some((rid, p)) = pending.iter().find(|(_, p)| p.app_id == app_id) {
            return Err(RpcError::new(Code::RegistrationPending).with("requestId", rid.clone()).with("expiresAt", p.expires_at));
        }
        if pending.len() >= MAX_PENDING {
            return Err(RpcError::new(Code::RateLimited).reason("tooManyPending").with("retryAfterMs", 60_000));
        }
        let rid = store::random_id("req_");
        let expires_at = now_ms() + PENDING_TTL_MS;
        pending.insert(rid.clone(), Pending { conn, kind, app_id: app_id.into(), identity, details, scopes, expires_at });
        Ok((rid, expires_at))
    }

    /// Shows the consent screen and the system notification, and arms the expiry.
    fn ask_user(self: &Server, rid: &str, name: &str, kind: Kind) {
        let payload = self.consent_payload(rid);
        self.host.emit("api:consent", payload);
        let (title, body) = match kind {
            Kind::Identity => (format!("{name} was updated or moved"), "Open Sonolith to allow it again.".to_string()),
            Kind::Scopes => (format!("{name} asks for more access"), "Open Sonolith to review the request.".to_string()),
            Kind::Register => (format!("{name} wants to connect to Sonolith"), "Open Sonolith to allow or deny it.".to_string()),
        };
        self.host.notify(rid, &title, &body);
    }

    fn consent_payload(&self, rid: &str) -> Value {
        let pending = self.pending.lock().unwrap();
        let Some(p) = pending.get(rid) else { return Value::Null };
        let reg = self.registry.lock().unwrap();
        let existing = reg.app(&p.app_id);
        let granted: Vec<String> = existing.map(|a| a.scopes.clone()).unwrap_or_default();
        let d = |k: &str| p.details.get(k).cloned().unwrap_or(Value::Null);
        let (name, publisher, description, homepage, icon) = match (p.kind, existing) {
            (Kind::Register, _) | (_, None) => (d("name"), d("publisher"), d("description"), d("homepage"), d("icon")),
            (_, Some(a)) => (json!(a.name), json!(a.publisher), json!(a.description), json!(a.homepage), json!(a.icon)),
        };
        json!({
            "requestId": rid,
            "kind": p.kind.name(),
            "appId": p.app_id,
            "name": name,
            "publisher": publisher,
            "description": description,
            "homepage": homepage,
            "icon": icon,
            "identity": p.identity,
            // The program the user allowed before: an identity change, or another registration under a taken id.
            "previousIdentity": existing.filter(|a| p.kind == Kind::Identity || (p.kind == Kind::Register && a.identity.key != p.identity.key)).map(|a| &a.identity),
            "alreadyRegistered": p.kind == Kind::Register && existing.is_some(),
            "grantedScopes": if p.kind == Kind::Scopes { granted } else { Vec::new() },
            "scopes": p.scopes.iter().map(|(s, req, reason)| json!({
                "scope": s, "required": req, "reason": reason,
                "label": methods::scope_label(s), "sensitive": methods::scope_sensitive(s),
            })).collect::<Vec<_>>(),
            "expiresAt": p.expires_at,
        })
    }

    /// Open consent requests, for a frontend that (re)loads while some are waiting.
    pub fn open_consents(&self) -> Vec<Value> {
        let ids: Vec<String> = self.pending.lock().unwrap().keys().cloned().collect();
        ids.iter().map(|r| self.consent_payload(r)).filter(|v| !v.is_null()).collect()
    }

    /// Expires requests nobody answered. Called once a second by the listener task.
    pub fn expire(&self) {
        let now = now_ms();
        let expired: Vec<String> =
            self.pending.lock().unwrap().iter().filter(|(_, p)| p.expires_at <= now).map(|(k, _)| k.clone()).collect();
        for rid in expired {
            let _ = self.resolve(&rid, Decision::Expire, &[]);
        }
    }

    /// The user's answer (or the expiry) for a request.
    pub fn resolve(&self, rid: &str, decision: Decision, chosen: &[String]) -> Result<(), String> {
        let p = self.pending.lock().unwrap().remove(rid).ok_or("no such request")?;
        self.host.close_notification(rid);
        self.host.emit("api:consent-cancel", json!({ "requestId": rid }));
        let now = now_ms();
        let mut token = Value::Null;
        let mut granted = Value::Null;
        let mut retry = Value::Null;
        let status = match decision {
            Decision::Allow => {
                // Required scopes are always granted; optional ones only when the user left them ticked.
                let scopes: Vec<String> = p
                    .scopes
                    .iter()
                    .filter(|(s, required, _)| *required || chosen.iter().any(|c| c == s))
                    .map(|(s, _, _)| s.clone())
                    .collect();
                match p.kind {
                    Kind::Register => {
                        let t = store::new_token();
                        self.replace_app(&p, &scopes, &t, now);
                        token = json!(t);
                        granted = json!(scopes);
                    }
                    Kind::Identity => {
                        let mut reg = self.registry.lock().unwrap();
                        if let Some(a) = reg.app_mut(&p.app_id) {
                            a.identity = p.identity.clone();
                            granted = json!(a.scopes);
                        }
                        let _ = reg.save(&self.registry_path);
                    }
                    Kind::Scopes => {
                        let all = {
                            let mut reg = self.registry.lock().unwrap();
                            let Some(a) = reg.app_mut(&p.app_id) else { return Ok(()) };
                            for s in &scopes {
                                if !a.scopes.contains(s) {
                                    a.scopes.push(s.clone());
                                }
                            }
                            a.scopes.sort_by_key(|s| methods::SCOPES.iter().position(|x| x == s));
                            let all = a.scopes.clone();
                            let _ = reg.save(&self.registry_path);
                            all
                        };
                        granted = json!(all);
                        self.scopes_changed(&p.app_id, all, scopes, Vec::new());
                    }
                }
                "approved"
            }
            Decision::Deny | Decision::Expire => {
                let mut reg = self.registry.lock().unwrap();
                reg.record_denial(&p.app_id, &p.identity.key, now, decision == Decision::Expire);
                retry = json!(reg.cooldown(&p.app_id, &p.identity.key, now).unwrap_or(0));
                let _ = reg.save(&self.registry_path);
                if decision == Decision::Expire { "expired" } else { "denied" }
            }
            Decision::Block => {
                let name = p.details.get("name").and_then(Value::as_str).map(String::from).or_else(|| {
                    self.registry.lock().unwrap().app(&p.app_id).map(|a| a.name.clone())
                });
                // The requesting program only: another program registered under this id is not the one asking.
                let mut reg = self.registry.lock().unwrap();
                reg.block(&p.app_id, name.as_deref().unwrap_or(&p.app_id), &p.identity, now, false);
                let _ = reg.save(&self.registry_path);
                "blocked"
            }
        };
        let params = json!({
            "requestId": rid, "kind": p.kind.name(), "status": status,
            "token": token, "grantedScopes": granted, "retryAfterMs": retry,
        });
        self.send(p.conn, protocol::notification("registration.resolved", params), false);
        if let Some(c) = self.conns.lock().unwrap().get_mut(&p.conn) {
            c.idle_since = Instant::now();
        }
        if decision == Decision::Block {
            self.drop_identity(&p.identity.key);
        }
        self.maybe_finish(p.conn);
        self.emit_apps_changed();
        Ok(())
    }

    /// The registry changes first and the old sessions end after: a `session.hello` in between then fails instead of
    /// starting a session the revocation has already passed by (see `hello`).
    fn replace_app(&self, p: &Pending, scopes: &[String], token: &str, now: u64) {
        let d = |k: &str| p.details.get(k).and_then(Value::as_str).map(String::from);
        let mut reg = self.registry.lock().unwrap();
        let had = reg.remove(&p.app_id).is_some();
        reg.apps.push(AppRecord {
            app_id: p.app_id.clone(),
            name: d("name").unwrap_or_default(),
            description: d("description").unwrap_or_default(),
            publisher: d("publisher").unwrap_or_default(),
            homepage: d("homepage"),
            icon: d("icon"),
            identity: p.identity.clone(),
            token_hash: store::hash_token(token),
            scopes: scopes.to_vec(),
            registered_at: now,
            last_used_at: None,
        });
        let _ = reg.save(&self.registry_path);
        drop(reg);
        if had {
            self.revoke_app(&p.app_id, "replaced");
        }
    }

    fn request_scopes(&self, conn: u64, p: &Map<String, Value>, app_id: String, identity: Option<AppIdentity>) -> Result<Value, RpcError> {
        let v = Params::new(p, &["scopes"])?;
        let requested = v.scope_requests("scopes")?;
        let (granted, name) = {
            let reg = self.registry.lock().unwrap();
            let a = reg.app(&app_id).ok_or_else(|| RpcError::new(Code::NotRegistered))?;
            (a.scopes.clone(), a.name.clone())
        };
        let new: Vec<_> = requested.into_iter().filter(|(s, _, _)| !granted.contains(s)).collect();
        if new.is_empty() {
            return Ok(json!({ "status": "granted", "requestId": null, "expiresAt": null, "grantedScopes": granted }));
        }
        let identity = identity.ok_or_else(|| RpcError::new(Code::Unavailable).reason("peerUnverified"))?;
        if let Some(wait) = self.registry.lock().unwrap().cooldown(&app_id, &identity.key, now_ms()) {
            return Err(RpcError::new(Code::RegistrationDenied).with("retryAfterMs", wait));
        }
        let (rid, expires_at) = self.open_request(conn, Kind::Scopes, &app_id, identity, Map::new(), new)?;
        self.ask_user(&rid, &name, Kind::Scopes);
        Ok(json!({ "status": "pending", "requestId": rid, "expiresAt": expires_at, "grantedScopes": granted }))
    }

    fn unregister(&self, app_id: String, conn: u64) -> Result<Value, RpcError> {
        let removed = {
            let mut reg = self.registry.lock().unwrap();
            let r = reg.remove(&app_id);
            let _ = reg.save(&self.registry_path);
            r
        };
        // Other connections of the app are told; this one gets the response and then closes.
        self.revoke_except(&app_id, "unregistered", Some(conn));
        if let Some(a) = removed {
            self.host.emit("api:toast", json!({ "message": format!("{} disconnected from Sonolith", a.name) }));
        }
        self.emit_apps_changed();
        Ok(json!({}))
    }

    // ------------------------------------------------------------ sessions

    fn hello(&self, conn: u64, p: &Map<String, Value>, identity: Option<AppIdentity>, authed: bool) -> Result<Value, RpcError> {
        if authed {
            return Err(RpcError::new(Code::InvalidRequest).reason("alreadyAuthenticated"));
        }
        let v = Params::new(p, &["appId", "token", "apiVersion"])?;
        let app_id = v.app_id("appId")?;
        let token = v.text("token", 1, 100)?;
        v.version()?;
        let identity = identity.ok_or_else(|| RpcError::new(Code::Unavailable).reason("peerUnverified"))?;
        let (record_identity, name) = {
            let reg = self.registry.lock().unwrap();
            if reg.is_blocked(&app_id, &identity.key) {
                return Err(RpcError::new(Code::Blocked));
            }
            let a = reg.app(&app_id).ok_or_else(|| RpcError::new(Code::NotRegistered))?;
            if !reg.token_matches(&app_id, &token) {
                return Err(RpcError::new(Code::Unauthorized));
            }
            (a.identity.clone(), a.name.clone())
        };
        if record_identity.key != identity.key {
            self.admit_request(&app_id, &identity)?;
            let (rid, expires_at) = self.open_request(conn, Kind::Identity, &app_id, identity, Map::new(), Vec::new())?;
            self.ask_user(&rid, &name, Kind::Identity);
            return Err(RpcError::new(Code::RegistrationPending).reason("identityChanged").with("requestId", rid).with("expiresAt", expires_at));
        }
        // The session starts under the registry lock, checked once more: removing, replacing or blocking the app
        // changes the registry first and revokes sessions after, so a hello is either revoked or refused, never
        // missed. Scopes come from the same look, so a scope revoked meanwhile isn't granted either.
        let scopes = {
            let mut reg = self.registry.lock().unwrap();
            if reg.is_blocked(&app_id, &identity.key) {
                return Err(RpcError::new(Code::Blocked));
            }
            let a = reg.app(&app_id).ok_or_else(|| RpcError::new(Code::NotRegistered))?;
            if !reg.token_matches(&app_id, &token) || a.identity.key != identity.key {
                return Err(RpcError::new(Code::Unauthorized));
            }
            let scopes = a.scopes.clone();
            {
                let mut conns = self.conns.lock().unwrap();
                let count = conns.values().filter(|c| c.app_id.as_deref() == Some(&app_id) && !c.closing).count();
                if count >= MAX_APP_CONNECTIONS {
                    return Err(RpcError::new(Code::RateLimited).reason("tooManyConnections").with("retryAfterMs", 1000));
                }
                let c = conns.get_mut(&conn).ok_or_else(|| RpcError::new(Code::InternalError))?;
                c.app_id = Some(app_id.clone());
                c.scopes = scopes.clone();
            }
            if let Some(a) = reg.app_mut(&app_id) {
                a.last_used_at = Some(now_ms());
            }
            let _ = reg.save(&self.registry_path);
            scopes
        };
        self.emit_apps_changed();
        Ok(json!({
            "apiVersion": protocol::API_VERSION,
            "appVersion": self.app_version,
            "appId": app_id,
            "grantedScopes": scopes,
            "signedIn": self.signed_in(),
            "identity": record_identity,
        }))
    }

    /// Sends `session.revoked` to every connection of the app and closes them.
    fn revoke_app(&self, app_id: &str, reason: &str) {
        self.revoke_except(app_id, reason, None);
    }

    fn revoke_except(&self, app_id: &str, reason: &str, except: Option<u64>) {
        self.revoke_where(reason, |id, c| c.app_id.as_deref() == Some(app_id) && Some(id) != except);
    }

    /// A blocked program: its registrations go, and its sessions end, under whatever app id.
    fn drop_identity(&self, key: &str) {
        let gone: Vec<String> = {
            let mut reg = self.registry.lock().unwrap();
            let ids: Vec<String> = reg.apps.iter().filter(|a| a.identity.key == key).map(|a| a.app_id.clone()).collect();
            if !ids.is_empty() {
                reg.apps.retain(|a| a.identity.key != key);
                let _ = reg.save(&self.registry_path);
            }
            ids
        };
        self.revoke_where("blocked", |_, c| {
            c.identity.as_ref().is_some_and(|i| i.key == key) || gone.iter().any(|g| c.app_id.as_deref() == Some(g.as_str()))
        });
    }

    /// Sends `session.revoked` to every authenticated connection matching `pred` and closes them.
    fn revoke_where(&self, reason: &str, pred: impl Fn(u64, &Conn) -> bool) {
        let msg = protocol::notification("session.revoked", json!({ "reason": reason }));
        let ids: Vec<u64> = {
            let conns = self.conns.lock().unwrap();
            conns
                .iter()
                .filter(|(id, c)| c.app_id.is_some() && pred(**id, c))
                .map(|(id, c)| {
                    self.send_to(c, &msg, false);
                    *id
                })
                .collect()
        };
        for id in ids {
            if let Some(c) = self.conns.lock().unwrap().get_mut(&id) {
                c.app_id = None;
                c.scopes.clear();
                c.topics.clear();
            }
            self.close(id);
        }
    }

    fn scopes_changed(&self, app_id: &str, all: Vec<String>, added: Vec<String>, removed: Vec<String>) {
        let msg = protocol::notification("session.scopesChanged", json!({ "grantedScopes": all, "added": added, "removed": removed }));
        let mut conns = self.conns.lock().unwrap();
        for c in conns.values_mut() {
            if c.app_id.as_deref() != Some(app_id) {
                continue;
            }
            c.scopes = all.clone();
            c.topics.retain(|t| methods::topic_scope(t).flatten().is_none_or(|s| all.iter().any(|g| g == s)));
            if !c.topics.contains("player.position") {
                c.position_gen += 1;
            }
            self.send_to(c, &msg, false);
        }
    }

    // ------------------------------------------------------------ settings (Connected apps)

    /// Removes an app (Settings → Connected apps): its token stops working and connected clients are told.
    pub fn remove_app(&self, app_id: &str) {
        // Registry first, then the sessions (see `hello`).
        let mut reg = self.registry.lock().unwrap();
        reg.remove(app_id);
        let _ = reg.save(&self.registry_path);
        drop(reg);
        self.revoke_app(app_id, "removed");
        self.emit_apps_changed();
    }

    pub fn remove_all(&self) {
        let ids: Vec<String> = self.registry.lock().unwrap().apps.iter().map(|a| a.app_id.clone()).collect();
        for id in ids {
            self.remove_app(&id);
        }
    }

    pub fn revoke_scope(&self, app_id: &str, scope: &str) {
        let all = {
            let mut reg = self.registry.lock().unwrap();
            let Some(a) = reg.app_mut(app_id) else { return };
            if !a.scopes.iter().any(|s| s == scope) {
                return;
            }
            a.scopes.retain(|s| s != scope);
            let all = a.scopes.clone();
            let _ = reg.save(&self.registry_path);
            all
        };
        self.scopes_changed(app_id, all, Vec::new(), vec![scope.to_string()]);
        self.update_lyrics_wanted();
        self.emit_apps_changed();
    }

    pub fn block_app(&self, app_id: &str) {
        let rec = self.registry.lock().unwrap().app(app_id).cloned();
        if let Some(a) = rec {
            // Registry first, then the sessions (see `hello`).
            let mut reg = self.registry.lock().unwrap();
            reg.remove(app_id);
            reg.block(app_id, &a.name, &a.identity, now_ms(), true);
            let _ = reg.save(&self.registry_path);
            drop(reg);
            self.revoke_app(app_id, "blocked");
        }
        self.emit_apps_changed();
    }

    pub fn unblock(&self, app_id: &str) {
        let mut reg = self.registry.lock().unwrap();
        reg.unblock(app_id);
        let _ = reg.save(&self.registry_path);
        drop(reg);
        self.emit_apps_changed();
    }

    /// Registered and blocked apps with live connection state and recent activity, for Settings.
    pub fn apps(&self) -> Value {
        let reg = self.registry.lock().unwrap().clone();
        let conns = self.conns.lock().unwrap();
        let activity = self.activity.lock().unwrap();
        let apps: Vec<Value> = reg
            .apps
            .iter()
            .map(|a| {
                let connections = conns.values().filter(|c| c.app_id.as_deref() == Some(&a.app_id) && !c.closing).count();
                let recent: Vec<Value> = activity
                    .get(&a.app_id)
                    .map(|l| l.iter().map(|(m, at)| json!({ "method": m, "at": at })).collect())
                    .unwrap_or_default();
                json!({
                    "appId": a.app_id, "name": a.name, "description": a.description, "publisher": a.publisher,
                    "homepage": a.homepage, "icon": a.icon, "identity": a.identity, "scopes": a.scopes,
                    "registeredAt": a.registered_at, "lastUsedAt": a.last_used_at, "connections": connections,
                    "activity": recent,
                })
            })
            .collect();
        json!({ "apps": apps, "blocked": reg.blocked, "registryProblem": self.registry_problem })
    }

    fn emit_apps_changed(&self) {
        self.host.emit("api:apps-changed", Value::Null);
    }

    /// Ends every connection at once (the API was turned off), also those of clients that stopped reading. Tokens
    /// stay valid.
    pub fn close_all(&self) {
        let ids: Vec<u64> = self.conns.lock().unwrap().keys().copied().collect();
        for id in ids {
            self.abort(id);
        }
    }

    // ------------------------------------------------------------ events

    fn subscribe(self: &Arc<Self>, conn: u64, p: &Map<String, Value>) -> Result<Value, RpcError> {
        let v = Params::new(p, &["topics", "positionHz"])?;
        let topics = v.topics("topics")?;
        let hz = match p.get("positionHz") {
            None => None,
            Some(x) => Some(x.as_u64().filter(|h| (1..=4).contains(h)).ok_or_else(|| v.invalid("positionHz"))?),
        };
        let (added, result, start_position) = {
            let mut conns = self.conns.lock().unwrap();
            let c = conns.get_mut(&conn).ok_or_else(|| RpcError::new(Code::InternalError))?;
            // Against the scopes as they are now, under the lock `revoke_scope` takes: a scope revoked since this
            // request started must not let a subscription through.
            for t in &topics {
                if let Some(Some(scope)) = methods::topic_scope(t) {
                    if !c.scopes.iter().any(|s| s == scope) {
                        return Err(RpcError::new(Code::PermissionDenied).with("scope", scope));
                    }
                }
            }
            let added: Vec<String> = topics.iter().filter(|t| !c.topics.contains(*t)).cloned().collect();
            c.topics.extend(added.iter().cloned());
            let hz_changed = hz.is_some_and(|h| h != c.position_hz);
            if let Some(h) = hz {
                c.position_hz = h;
            }
            let start = c.topics.contains("player.position") && (added.iter().any(|t| t == "player.position") || hz_changed);
            if start {
                c.position_gen += 1;
            }
            c.snapshots_due.extend(added.iter().cloned());
            (added, json!({ "topics": sorted_topics(&c.topics), "positionHz": c.position_hz }), start.then_some(c.position_gen))
        };
        if let Some(generation) = start_position {
            tokio::spawn(position_task(Arc::downgrade(self), conn, generation));
        }
        if added.iter().any(|t| t.starts_with("lyrics")) {
            self.update_lyrics_wanted();
        }
        Ok(result)
    }

    fn unsubscribe(&self, conn: u64, p: &Map<String, Value>) -> Result<Value, RpcError> {
        let v = Params::new(p, &["topics"])?;
        let topics = v.topics("topics")?;
        let result = {
            let mut conns = self.conns.lock().unwrap();
            let c = conns.get_mut(&conn).ok_or_else(|| RpcError::new(Code::InternalError))?;
            for t in &topics {
                c.topics.remove(t);
            }
            if !c.topics.contains("player.position") {
                c.position_gen += 1;
            }
            json!({ "topics": sorted_topics(&c.topics), "positionHz": c.position_hz })
        };
        self.update_lyrics_wanted();
        Ok(result)
    }

    fn send_snapshots(&self, conn: u64, topics: &[String]) {
        let scopes = self.conns.lock().unwrap().get(&conn).map(|c| c.scopes.clone()).unwrap_or_default();
        let state = self.player_state().map(|s| for_scopes(s, &scopes));
        let (queue, signed_in, lyrics) = {
            let p = self.published.lock().unwrap();
            (p.queue.clone(), p.signed_in.unwrap_or(false), p.lyrics.clone())
        };
        for t in topics {
            let msg = match t.as_str() {
                "player.state" => state.clone().map(|s| ("player.stateChanged", s)),
                "player.track" => Some(("player.trackChanged", json!({ "item": state.as_ref().map(|s| s["item"].clone()).unwrap_or(Value::Null) }))),
                "player.volume" => state.as_ref().map(|s| ("player.volumeChanged", json!({ "volume": s["volume"], "muted": s["muted"] }))),
                "player.position" => state.as_ref().filter(|s| !s["item"].is_null()).map(|s| ("player.position", position_params(s))),
                "queue" => queue.clone().map(|mut q| {
                    q["reason"] = json!("other");
                    ("queue.changed", q)
                }),
                "lyrics" => Some(("lyrics.changed", lyrics.clone().unwrap_or_else(|| self.no_lyrics(state.as_ref())))),
                "lyrics.line" => self.current_line(state.as_ref(), lyrics.as_ref()).map(|l| ("lyrics.line", l)),
                "account" => Some(("account.changed", json!({ "signedIn": signed_in }))),
                _ => None,
            };
            if let Some((method, params)) = msg {
                self.send(conn, protocol::notification(method, params), false);
            }
        }
    }

    fn no_lyrics(&self, state: Option<&Value>) -> Value {
        let id = state.and_then(|s| s["item"]["id"].as_str()).unwrap_or("");
        json!({ "trackId": id, "status": "notFound", "lyrics": null })
    }

    /// Sends an event to every connection subscribed to the topic. The current item goes without ratings and
    /// episode progress to apps without `library:read`.
    fn broadcast(&self, topic: &str, method: &str, params: Value, droppable: bool) {
        let redacted = matches!(topic, "player.state" | "player.track").then(|| protocol::notification(method, for_scopes(params.clone(), &[])));
        let msg = protocol::notification(method, params);
        let conns = self.conns.lock().unwrap();
        for c in conns.values() {
            if c.topics.contains(topic) {
                let full = redacted.is_none() || c.scopes.iter().any(|s| s == "library:read");
                self.send_to(c, if full { &msg } else { redacted.as_ref().unwrap() }, droppable);
            }
        }
    }

    /// Sends now, or once at most every 100 ms with the latest params.
    fn coalesced(self: &Arc<Self>, topic: &'static str, method: &str, params: Value) {
        let now = Instant::now();
        let mut params = Some(params);
        let delay = {
            let mut map = self.coalesce.lock().unwrap();
            let c = map.entry(topic).or_default();
            match c.last {
                Some(last) if now.duration_since(last) < COALESCE => {
                    c.pending = params.take().map(|p| (method.to_string(), p));
                    if c.scheduled {
                        return;
                    }
                    c.scheduled = true;
                    Some(COALESCE - now.duration_since(last))
                }
                _ => {
                    c.last = Some(now);
                    None
                }
            }
        };
        match delay {
            None => self.broadcast(topic, method, params.take().unwrap_or_default(), false),
            Some(d) => {
                let weak = Arc::downgrade(self);
                tokio::spawn(async move {
                    tokio::time::sleep(d).await;
                    let Some(s) = weak.upgrade() else { return };
                    let next = {
                        let mut map = s.coalesce.lock().unwrap();
                        let c = map.entry(topic).or_default();
                        c.scheduled = false;
                        c.last = Some(Instant::now());
                        c.pending.take()
                    };
                    if let Some((m, p)) = next {
                        s.broadcast(topic, &m, p, false);
                    }
                });
            }
        }
    }

    fn update_lyrics_wanted(&self) {
        let wanted = self.conns.lock().unwrap().values().any(|c| c.topics.iter().any(|t| t.starts_with("lyrics")));
        if self.lyrics_wanted.swap(wanted, Ordering::Relaxed) != wanted {
            self.host.emit("api:lyrics-wanted", json!(wanted));
        }
        self.clock.send_modify(|v| *v += 1);
    }

    pub fn lyrics_wanted(&self) -> bool {
        self.lyrics_wanted.load(Ordering::Relaxed)
    }

    // ------------------------------------------------------------ state from the frontend

    /// The player state now, with the position extrapolated while playing.
    fn player_state(&self) -> Option<Value> {
        let mut s = self.published.lock().unwrap().player.clone()?;
        let now = now_ms();
        let pos = extrapolate(&s, now);
        s["positionMs"] = json!(pos);
        s["positionAt"] = json!(now);
        Some(s)
    }

    /// The frontend published new state: `player`, `queue`, `account` or `lyrics`.
    pub fn publish(self: &Arc<Self>, kind: &str, payload: Value) {
        match kind {
            "player" => self.publish_player(payload),
            "queue" => {
                let mut summary = payload.clone();
                if let Some(o) = summary.as_object_mut() {
                    o.remove("reason");
                }
                self.published.lock().unwrap().queue = Some(summary);
                self.coalesced("queue", "queue.changed", payload);
            }
            "account" => {
                let signed_in = payload["signedIn"].as_bool().unwrap_or(false);
                let old = self.published.lock().unwrap().signed_in.replace(signed_in);
                if old.is_some_and(|o| o != signed_in) {
                    self.broadcast("account", "account.changed", json!({ "signedIn": signed_in }), false);
                }
            }
            "lyrics" => {
                let current = self.published.lock().unwrap().player.as_ref().and_then(|p| p["item"]["id"].as_str().map(String::from));
                if payload["trackId"].as_str() != current.as_deref() {
                    return;
                }
                let same = self.published.lock().unwrap().lyrics.as_ref() == Some(&payload);
                if same {
                    return;
                }
                self.published.lock().unwrap().lyrics = Some(payload.clone());
                self.broadcast("lyrics", "lyrics.changed", payload, false);
                self.clock.send_modify(|v| *v += 1);
            }
            _ => {}
        }
    }

    fn publish_player(self: &Arc<Self>, new: Value) {
        let old = self.published.lock().unwrap().player.replace(new.clone());
        let now = now_ms();
        let item_id = |s: &Value| (s["item"]["type"].clone(), s["item"]["id"].clone());
        let track_changed = old.as_ref().is_none_or(|o| item_id(o) != item_id(&new));
        let volume_changed = old.as_ref().is_none_or(|o| o["volume"] != new["volume"] || o["muted"] != new["muted"]);
        // Anything but the position moving on, or a jump (a seek).
        let without_position = |s: &Value| {
            let mut s = s.clone();
            if let Some(o) = s.as_object_mut() {
                o.remove("positionMs");
                o.remove("positionAt");
            }
            s
        };
        let jumped = old.as_ref().is_some_and(|o| (extrapolate(o, now) as i64 - extrapolate(&new, now) as i64).abs() > 1500);
        let state_changed = old.as_ref().is_none_or(|o| without_position(o) != without_position(&new)) || jumped;
        if track_changed {
            let id = new["item"]["id"].as_str().map(String::from);
            let mut p = self.published.lock().unwrap();
            if p.lyrics.as_ref().and_then(|l| l["trackId"].as_str()) != id.as_deref() {
                p.lyrics = None;
            }
            drop(p);
            self.broadcast("player.track", "player.trackChanged", json!({ "item": new["item"] }), false);
            let gone = json!({ "trackId": id.unwrap_or_default(), "status": "notFound", "lyrics": null });
            self.broadcast("lyrics", "lyrics.changed", gone, false);
        }
        if volume_changed {
            self.coalesced("player.volume", "player.volumeChanged", json!({ "volume": new["volume"], "muted": new["muted"] }));
        }
        if state_changed {
            if let Some(s) = self.player_state() {
                self.coalesced("player.state", "player.stateChanged", s.clone());
                if !s["item"].is_null() {
                    let status_changed = old.as_ref().is_none_or(|o| o["status"] != new["status"]);
                    if status_changed || jumped || track_changed {
                        self.broadcast("player.position", "player.position", position_params(&s), false);
                    }
                }
            }
        }
        self.clock.send_modify(|v| *v += 1);
    }

    fn current_line(&self, state: Option<&Value>, lyrics: Option<&Value>) -> Option<Value> {
        let state = state?;
        if state["status"] != "playing" {
            return None;
        }
        let lyrics = lyrics?;
        let lines = Timing::parse(lyrics)?;
        let pos = extrapolate(state, now_ms());
        let (line, _) = lines.at(pos);
        Some(line_params(lyrics, line, pos))
    }

    // ------------------------------------------------------------ bridge to the frontend

    pub fn frontend_ready(&self, ready: bool) {
        self.frontend_ready.store(ready, Ordering::Relaxed);
    }

    async fn call_frontend(&self, conn: u64, method: &str, params: &Map<String, Value>, app_id: &str, scopes: &[String]) -> Result<Value, RpcError> {
        if !self.frontend_ready.load(Ordering::Relaxed) {
            return Err(RpcError::new(Code::Unavailable).reason("starting").with("retryAfterMs", 2000));
        }
        let id = self.id();
        let (tx, rx) = oneshot::channel();
        self.bridge.lock().unwrap().insert(id, (conn, tx));
        self.host.emit("api:call", json!({ "id": id, "method": method, "params": params, "appId": app_id, "scopes": scopes }));
        let out = tokio::time::timeout(BRIDGE_TIMEOUT, rx).await;
        if self.bridge.lock().unwrap().remove(&id).is_some() {
            // No answer in time: the frontend stops working on it rather than finishing for nobody.
            self.host.emit("api:cancel", json!({ "id": id }));
        }
        match out {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err(RpcError::new(Code::InternalError)),
            Err(_) => Err(RpcError::new(Code::Timeout)),
        }
    }

    /// The frontend's answer to an `api:call`.
    pub fn bridge_reply(&self, id: u64, result: Option<Value>, error: Option<Value>) {
        if let Some((_, tx)) = self.bridge.lock().unwrap().remove(&id) {
            let _ = tx.send(match error {
                Some(e) => Err(RpcError::from_bridge(&e)),
                None => Ok(result.unwrap_or(json!({}))),
            });
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny,
    Block,
    Expire,
}

/// Player state or `player.trackChanged` params as an app with these scopes may see them: without `library:read`,
/// the item's rating (tracks) and played state and resume position (episodes) are null.
fn for_scopes(mut v: Value, scopes: &[String]) -> Value {
    if scopes.iter().any(|s| s == "library:read") {
        return v;
    }
    if let Some(item) = v.get_mut("item").and_then(Value::as_object_mut) {
        let keys: &[&str] = if item.get("type").and_then(Value::as_str) == Some("episode") { &["played", "resumePositionMs"] } else { &["rating"] };
        for k in keys {
            if item.contains_key(*k) {
                item.insert(k.to_string(), Value::Null);
            }
        }
    }
    v
}

fn sorted_topics(set: &HashSet<String>) -> Vec<&'static str> {
    methods::TOPICS.iter().map(|(t, _)| *t).filter(|t| set.contains(*t)).collect()
}

fn extrapolate(s: &Value, now: u64) -> u64 {
    let pos = s["positionMs"].as_u64().unwrap_or(0);
    if s["status"] != "playing" {
        return pos;
    }
    let at = s["positionAt"].as_u64().unwrap_or(now);
    let rate = s["rate"].as_f64().unwrap_or(1.0);
    let p = pos + (now.saturating_sub(at) as f64 * rate) as u64;
    match s["durationMs"].as_u64() {
        Some(d) => p.min(d),
        None => p,
    }
}

fn position_params(s: &Value) -> Value {
    json!({
        "positionMs": s["positionMs"], "positionAt": s["positionAt"], "durationMs": s["durationMs"],
        "rate": s["rate"], "status": s["status"],
    })
}

fn line_params(lyrics: &Value, line: Option<usize>, pos: u64) -> Value {
    let l = line.map(|i| &lyrics["lyrics"]["lines"][i]);
    json!({
        "trackId": lyrics["trackId"],
        "lineIndex": line,
        "text": l.map(|l| l["text"].clone()).unwrap_or(Value::Null),
        "startMs": l.map(|l| l["startMs"].clone()).unwrap_or(Value::Null),
        "endMs": l.map(|l| l["endMs"].clone()).unwrap_or(Value::Null),
        "positionMs": pos,
    })
}

/// Sends `player.position` at the connection's rate while playing. Ends when the connection's
/// `position_gen` moves on (unsubscribed, rate changed) or the connection is gone.
async fn position_task(weak: std::sync::Weak<Server>, conn: u64, generation: u64) {
    loop {
        let hz = {
            let Some(s) = weak.upgrade() else { return };
            let conns = s.conns.lock().unwrap();
            match conns.get(&conn) {
                Some(c) if c.position_gen == generation && !c.closing => c.position_hz.max(1),
                _ => return,
            }
        };
        tokio::time::sleep(Duration::from_millis(1000 / hz)).await;
        let Some(s) = weak.upgrade() else { return };
        if let Some(state) = s.player_state() {
            if state["status"] == "playing" {
                let msg = protocol::notification("player.position", position_params(&state));
                let conns = s.conns.lock().unwrap();
                if let Some(c) = conns.get(&conn).filter(|c| c.position_gen == generation) {
                    s.send_to(c, &msg, true);
                }
            }
        }
    }
}

/// Line and word start times of the current lyrics.
struct Timing {
    lines: Vec<(Option<u64>, Option<u64>, Vec<u64>, Vec<u64>)>,
}

impl Timing {
    fn parse(result: &Value) -> Option<Timing> {
        let lyrics = &result["lyrics"];
        if lyrics["tier"] == "unsynced" || lyrics.is_null() {
            return None;
        }
        let starts = |words: &Value| -> Vec<u64> {
            words.as_array().map(|w| w.iter().filter_map(|x| x["startMs"].as_u64()).collect()).unwrap_or_default()
        };
        let lines = lyrics["lines"]
            .as_array()?
            .iter()
            .map(|l| (l["startMs"].as_u64(), l["endMs"].as_u64(), starts(&l["words"]), starts(&l["background"])))
            .collect();
        Some(Timing { lines })
    }

    /// The line being sung at `pos` (None before the first line and in breaks) and the next boundary after `pos`.
    fn at(&self, pos: u64) -> (Option<usize>, Option<u64>) {
        let mut current = None;
        for (i, (start, end, _, _)) in self.lines.iter().enumerate() {
            let Some(start) = *start else { continue };
            if start > pos {
                break;
            }
            let next_start = self.lines[i + 1..].iter().find_map(|l| l.0);
            let end = end.or(next_start).unwrap_or(u64::MAX);
            current = (pos < end).then_some(i);
        }
        let mut next = u64::MAX;
        for (start, end, words, bg) in &self.lines {
            for t in start.iter().chain(end.iter()).chain(words).chain(bg) {
                if *t > pos && *t < next {
                    next = *t;
                }
            }
        }
        (current, (next != u64::MAX).then_some(next))
    }

    /// Words (main and background) that start in (from, to].
    fn words_between(&self, from: u64, to: u64) -> Vec<(usize, usize, bool, u64)> {
        let mut out = Vec::new();
        for (li, (_, _, words, bg)) in self.lines.iter().enumerate() {
            for (wi, t) in words.iter().enumerate() {
                if *t > from && *t <= to {
                    out.push((li, wi, false, *t));
                }
            }
            for (wi, t) in bg.iter().enumerate() {
                if *t > from && *t <= to {
                    out.push((li, wi, true, *t));
                }
            }
        }
        out.sort_by_key(|w| w.3);
        out
    }
}

/// Emits `lyrics.line` and `lyrics.word` at their boundaries, from the extrapolated playback clock. Sleeps until
/// the next boundary or a state change; does nothing while nobody subscribes or nothing plays.
async fn lyrics_clock(weak: std::sync::Weak<Server>, mut changes: watch::Receiver<u64>) {
    let mut last_line: Option<(String, Option<usize>)> = None;
    let mut last_pos: Option<(String, u64)> = None;
    loop {
        let wait = {
            let Some(s) = weak.upgrade() else { return };
            let (wants_line, wants_word) = {
                let conns = s.conns.lock().unwrap();
                (conns.values().any(|c| c.topics.contains("lyrics.line")), conns.values().any(|c| c.topics.contains("lyrics.word")))
            };
            let state = s.player_state();
            let lyrics = s.published.lock().unwrap().lyrics.clone();
            let timing = lyrics.as_ref().and_then(Timing::parse);
            match (state, lyrics, timing) {
                (Some(state), Some(lyrics), Some(timing)) if (wants_line || wants_word) && state["status"] == "playing" => {
                    let track = lyrics["trackId"].as_str().unwrap_or("").to_string();
                    let pos = extrapolate(&state, now_ms());
                    let (line, next) = timing.at(pos);
                    if wants_line && last_line.as_ref() != Some(&(track.clone(), line)) {
                        s.broadcast("lyrics.line", "lyrics.line", line_params(&lyrics, line, pos), false);
                    }
                    last_line = Some((track.clone(), line));
                    if wants_word {
                        // Words since the last check; after a jump, only the word that is on now.
                        let from = match &last_pos {
                            Some((t, p)) if *t == track && *p <= pos && pos - *p < 2000 => *p,
                            _ => pos.saturating_sub(1),
                        };
                        for (li, wi, bg, _) in timing.words_between(from, pos) {
                            let params = json!({ "trackId": track, "lineIndex": li, "wordIndex": wi, "background": bg, "positionMs": pos });
                            s.broadcast("lyrics.word", "lyrics.word", params, true);
                        }
                    }
                    last_pos = Some((track, pos));
                    let rate = state["rate"].as_f64().unwrap_or(1.0).max(0.1);
                    next.map(|n| Duration::from_millis((((n - pos) as f64) / rate).ceil() as u64 + 1).min(Duration::from_secs(5)))
                }
                _ => {
                    last_line = None;
                    last_pos = None;
                    None
                }
            }
        };
        match wait {
            Some(d) => {
                tokio::select! {
                    _ = tokio::time::sleep(d) => {}
                    r = changes.changed() => if r.is_err() { return },
                }
            }
            None => {
                if changes.changed().await.is_err() {
                    return;
                }
            }
        }
    }
}

/// No control characters (line breaks included) and no invisible format characters: direction overrides and isolates
/// could make a name read backwards ("Firefox" from "xoferiF"), and line breaks could fake a second line of a
/// notification. Ordinary text in any script passes.
fn plain_text(s: &str) -> bool {
    !s.chars().any(|c| {
        c.is_control()
            || matches!(c, '\u{AD}' | '\u{61C}' | '\u{180E}' | '\u{200B}'..='\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2060}'..='\u{206F}' | '\u{FEFF}' | '\u{FFF9}'..='\u{FFFB}')
    })
}

fn valid_icon(icon: &str) -> bool {
    let Some(data) = icon.strip_prefix("data:image/png;base64,") else { return false };
    use base64::Engine;
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data) else { return false };
    // PNG signature, then the IHDR chunk: width and height, at least 64 px.
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return false;
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    w >= 64 && h >= 64 && w == h
}

/// Parameter checks for the methods the server answers itself. Unknown params are rejected (SPEC.md 4.1).
struct Params<'a> {
    p: &'a Map<String, Value>,
}

impl<'a> Params<'a> {
    fn new(p: &'a Map<String, Value>, known: &[&str]) -> Result<Self, RpcError> {
        if let Some(k) = p.keys().find(|k| !known.contains(&k.as_str())) {
            return Err(RpcError::new(Code::InvalidParams).reason("unknownParam").with("path", format!("/{k}")));
        }
        Ok(Params { p })
    }

    fn invalid(&self, key: &str) -> RpcError {
        RpcError::new(Code::InvalidParams).with("path", format!("/{key}"))
    }

    fn opt_text(&self, key: &str, min: usize, max: usize) -> Result<Option<String>, RpcError> {
        match self.p.get(key) {
            None => Ok(None),
            Some(Value::String(s)) if (min..=max).contains(&s.chars().count()) => Ok(Some(s.clone())),
            Some(_) => Err(self.invalid(key)),
        }
    }

    fn text(&self, key: &str, min: usize, max: usize) -> Result<String, RpcError> {
        self.opt_text(key, min, max)?.ok_or_else(|| self.invalid(key))
    }

    /// Text for the consent screen and the notification: one line, no control or direction characters.
    fn plain(&self, key: &str, min: usize, max: usize) -> Result<String, RpcError> {
        let t = self.text(key, min, max)?;
        if plain_text(&t) { Ok(t) } else { Err(self.invalid(key)) }
    }

    fn app_id(&self, key: &str) -> Result<String, RpcError> {
        let id = self.text(key, 1, 128)?;
        let labels: Vec<&str> = id.split('.').collect();
        let label_ok = |l: &str, first: bool| {
            !l.is_empty()
                && l.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                && if first { l.as_bytes()[0].is_ascii_lowercase() } else { l.as_bytes()[0] != b'-' }
        };
        let ok = labels.len() >= 3 && labels.iter().enumerate().all(|(i, l)| label_ok(l, i == 0)) && !id.starts_with("dev.sonolith.");
        ok.then_some(id).ok_or_else(|| self.invalid(key))
    }

    fn version(&self) -> Result<(), RpcError> {
        let v = self.text("apiVersion", 3, 16)?;
        let shape = v.split('.').count() == 2 && v.split('.').all(|x| !x.is_empty() && x.bytes().all(|b| b.is_ascii_digit()));
        if !shape {
            return Err(self.invalid("apiVersion"));
        }
        if !protocol::version_supported(&v) {
            return Err(RpcError::new(Code::UnsupportedVersion).with("supported", json!([protocol::API_MAJOR])));
        }
        Ok(())
    }

    fn scope_requests(&self, key: &str) -> Result<Vec<(String, bool, String)>, RpcError> {
        let list = self.p.get(key).and_then(Value::as_array).ok_or_else(|| self.invalid(key))?;
        if list.is_empty() || list.len() > 8 {
            return Err(self.invalid(key));
        }
        let mut out: Vec<(String, bool, String)> = Vec::new();
        for (i, s) in list.iter().enumerate() {
            let bad = || RpcError::new(Code::InvalidParams).with("path", format!("/{key}/{i}"));
            let o = s.as_object().ok_or_else(bad)?;
            if o.keys().any(|k| !matches!(k.as_str(), "scope" | "required" | "reason")) {
                return Err(bad());
            }
            let scope = o.get("scope").and_then(Value::as_str).filter(|s| methods::SCOPES.contains(s)).ok_or_else(bad)?;
            let required = o.get("required").and_then(Value::as_bool).ok_or_else(bad)?;
            let reason = o.get("reason").and_then(Value::as_str).filter(|r| (1..=120).contains(&r.chars().count()) && plain_text(r)).ok_or_else(bad)?;
            if out.iter().any(|(x, _, _)| x == scope) {
                return Err(bad());
            }
            out.push((scope.into(), required, reason.into()));
        }
        Ok(out)
    }

    fn topics(&self, key: &str) -> Result<Vec<String>, RpcError> {
        let list = self.p.get(key).and_then(Value::as_array).ok_or_else(|| self.invalid(key))?;
        if list.is_empty() {
            return Err(self.invalid(key));
        }
        let mut out: Vec<String> = Vec::new();
        for (i, t) in list.iter().enumerate() {
            let t = t
                .as_str()
                .filter(|t| methods::topic_scope(t).is_some())
                .ok_or_else(|| RpcError::new(Code::InvalidParams).with("path", format!("/{key}/{i}")))?;
            if out.iter().any(|x| x == t) {
                return Err(RpcError::new(Code::InvalidParams).with("path", format!("/{key}/{i}")));
            }
            out.push(t.into());
        }
        Ok(out)
    }
}
