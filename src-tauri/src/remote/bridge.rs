//! The LAN listener: serves the phone page and bridges each phone to the local API server.
//!
//! A phone is a local API client. Pairing (the secret from the link) registers it with the player scopes; after that
//! it opens an event stream (`GET /api/stream`), on which Rust starts an in-memory connection to the API server and
//! says `session.hello` with the phone's token. Requests (`POST /api/rpc`) are written to that connection as JSON-RPC
//! lines, and everything the server sends back goes to the phone as server-sent events. Scopes, consent, rate limits
//! and revocation are the API server's own; this file only adds HTTP, pairing and the limits a network needs.

use super::guard::{self, PairLimit};
use super::http::{self, Head};
use crate::api::identity::AppIdentity;
use crate::api::server::{now_ms, Server};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Semaphore};

/// Open TCP connections at once (page loads, requests and streams together).
const MAX_SOCKETS: usize = 32;
/// Event streams at once, over all phones (the API server also caps each phone at 8).
const MAX_STREAMS: usize = 16;
/// Paired phones at most; a new link starts over.
const MAX_PHONES: usize = 10;
const MAX_PAIR_BODY: usize = 1024;
const MAX_RPC_BODY: usize = 16 * 1024;
/// Requests from one phone waiting to be written to its API connection.
const RPC_QUEUE: usize = 32;
/// How long a client may take to send its request.
const READ_TIMEOUT: Duration = Duration::from_secs(10);
/// A phone that stops reading its stream for this long is cut off.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const KEEPALIVE: Duration = Duration::from_secs(15);
const HELLO_ID: &str = "remote-hello";
/// What a phone gets at pairing; anything more it asks for with `app.requestScopes`, which the user confirms.
pub const PAIRED_SCOPES: &[&str] = &["player:read", "player:control"];

const INDEX: &str = include_str!("page/index.html");
const SCRIPT: &str = include_str!("page/app.js");
const LOGIC: &str = include_str!("page/logic.js");
const STYLE: &str = include_str!("page/app.css");
const MANIFEST: &str = include_str!("page/manifest.webmanifest");

struct Session {
    app_id: String,
    tx: mpsc::Sender<String>,
}

pub struct Remote {
    api: Arc<Server>,
    secret: Mutex<String>,
    limit: Mutex<PairLimit>,
    theme_css: Mutex<String>,
    sessions: Mutex<HashMap<String, Session>>,
    sockets: Arc<Semaphore>,
}

impl Remote {
    pub fn new(api: Arc<Server>, secret: String, theme_css: String) -> Arc<Remote> {
        Arc::new(Remote {
            api,
            secret: Mutex::new(secret),
            limit: Mutex::new(PairLimit::default()),
            theme_css: Mutex::new(theme_css),
            sessions: Mutex::new(HashMap::new()),
            sockets: Arc::new(Semaphore::new(MAX_SOCKETS)),
        })
    }

    /// A new link: the old secret stops pairing and the guess counts start over. (Unpairing is the caller's.)
    pub fn set_secret(&self, secret: String) {
        *self.secret.lock().unwrap() = secret;
        self.limit.lock().unwrap().reset();
    }

    pub fn set_theme(&self, css: String) {
        *self.theme_css.lock().unwrap() = css;
    }

    /// Accepts connections until the task is aborted. Over the socket limit, a connection is closed at once.
    pub async fn listen(self: Arc<Self>, listener: tokio::net::TcpListener) {
        loop {
            let Ok((sock, addr)) = listener.accept().await else {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            };
            let Ok(permit) = self.sockets.clone().try_acquire_owned() else { continue };
            let _ = sock.set_nodelay(true);
            let me = self.clone();
            tokio::spawn(async move {
                me.handle(sock, addr.ip()).await;
                drop(permit);
            });
        }
    }

    /// One request on one connection.
    pub async fn handle<S: AsyncRead + AsyncWrite + Unpin + Send>(self: Arc<Self>, mut sock: S, ip: IpAddr) {
        let Ok(Some((head, rest))) = tokio::time::timeout(READ_TIMEOUT, read_head(&mut sock)).await else {
            let _ = sock.write_all(&http::json(431, &json!({ "error": "badRequest" }))).await;
            return;
        };
        let out = match (head.method.as_str(), head.path.as_str()) {
            ("GET", "/") => http::response(200, "text/html; charset=utf-8", &format!("Content-Security-Policy: {}\r\n", http::PAGE_CSP), INDEX.as_bytes()),
            ("GET", "/app.js") => http::response(200, "text/javascript; charset=utf-8", "", SCRIPT.as_bytes()),
            ("GET", "/logic.js") => http::response(200, "text/javascript; charset=utf-8", "", LOGIC.as_bytes()),
            ("GET", "/app.css") => http::response(200, "text/css; charset=utf-8", "", STYLE.as_bytes()),
            ("GET", "/theme.css") => {
                let css = self.theme_css.lock().unwrap().clone();
                http::response(200, "text/css; charset=utf-8", "", css.as_bytes())
            }
            ("GET", "/manifest.webmanifest") => http::response(200, "application/manifest+json", "", MANIFEST.as_bytes()),
            ("GET", "/api/stream") => return self.stream(sock, &head).await,
            ("POST", "/api/pair") => match read_body(&mut sock, &head, rest, MAX_PAIR_BODY).await {
                Ok(body) => self.pair(&head, &body, ip),
                Err(status) => http::json(status, &json!({ "error": "badRequest" })),
            },
            ("POST", "/api/rpc") => match read_body(&mut sock, &head, rest, MAX_RPC_BODY).await {
                Ok(body) => self.rpc(&head, &body),
                Err(status) => http::json(status, &json!({ "error": "badRequest" })),
            },
            (_, "/" | "/app.js" | "/logic.js" | "/app.css" | "/theme.css" | "/manifest.webmanifest" | "/api/stream" | "/api/pair" | "/api/rpc") => {
                http::json(405, &json!({ "error": "methodNotAllowed" }))
            }
            _ => http::json(404, &json!({ "error": "notFound" })),
        };
        let _ = tokio::time::timeout(WRITE_TIMEOUT, sock.write_all(&out)).await;
        let _ = tokio::time::timeout(Duration::from_secs(1), sock.shutdown()).await;
    }

    fn pair(&self, head: &Head, body: &[u8], ip: IpAddr) -> Vec<u8> {
        if !same_origin(head) {
            return http::json(403, &json!({ "error": "crossOrigin" }));
        }
        let now = now_ms();
        if let Err(wait) = self.limit.lock().unwrap().admit(ip, now) {
            let extra = format!("Retry-After: {}\r\n", wait.div_ceil(1000));
            return http::response(429, "application/json", &extra, json!({ "error": "tooManyAttempts", "retryAfterMs": wait }).to_string().as_bytes());
        }
        let given = serde_json::from_slice::<Value>(body).ok().and_then(|v| v["secret"].as_str().map(String::from)).unwrap_or_default();
        let ok = guard::same_secret(&given, &self.secret.lock().unwrap());
        if !ok {
            self.limit.lock().unwrap().failed(ip, now);
            return http::json(403, &json!({ "error": "wrongLink" }));
        }
        if self.api.remote_counts().0 >= MAX_PHONES {
            return http::json(409, &json!({ "error": "tooManyPhones" }));
        }
        let name = guard::device_name(head.header("user-agent").unwrap_or(""));
        let (app_id, token) = self.api.pair_remote(name, PAIRED_SCOPES);
        http::json(200, &json!({ "appId": app_id, "token": token }))
    }

    /// The phone's credentials, when they are a paired phone's.
    fn authorized(&self, head: &Head) -> Option<(String, String)> {
        let (app_id, token) = head.bearer()?;
        self.api.remote_token_ok(app_id, token).then(|| (app_id.to_string(), token.to_string()))
    }

    fn rpc(&self, head: &Head, body: &[u8]) -> Vec<u8> {
        if !same_origin(head) {
            return http::json(403, &json!({ "error": "crossOrigin" }));
        }
        let Some((app_id, _)) = self.authorized(head) else {
            return http::json(401, &json!({ "error": "notPaired" }));
        };
        let tx = {
            let sessions = self.sessions.lock().unwrap();
            match head.header("x-session").and_then(|s| sessions.get(s)) {
                Some(s) if s.app_id == app_id => s.tx.clone(),
                _ => return http::json(409, &json!({ "error": "noStream" })),
            }
        };
        let Some(line) = rpc_line(body) else {
            return http::json(400, &json!({ "error": "badRequest" }));
        };
        match tx.try_send(line) {
            Ok(()) => http::json(202, &json!({})),
            Err(_) => http::json(429, &json!({ "error": "tooManyRequests" })),
        }
    }

    /// The event stream: an API connection for this phone, open as long as the phone listens.
    async fn stream<S: AsyncRead + AsyncWrite + Unpin + Send>(self: Arc<Self>, mut sock: S, head: &Head) {
        let send = |status: u16, body: Value| http::json(status, &body);
        let Some((app_id, token)) = self.authorized(head) else {
            let _ = sock.write_all(&send(401, json!({ "error": "notPaired" }))).await;
            return;
        };
        if self.sessions.lock().unwrap().len() >= MAX_STREAMS {
            let _ = sock.write_all(&send(429, json!({ "error": "tooManyStreams" }))).await;
            return;
        }
        let (ours, theirs) = tokio::io::duplex(256 * 1024);
        // In memory, end of input means the phone is gone: nothing half-closes here.
        tokio::spawn(self.api.clone().serve_as(theirs, Some(AppIdentity::remote(&app_id)), std::future::ready(())));
        let (rd, mut api_wr) = tokio::io::split(ours);
        let mut api_rd = BufReader::new(rd).lines();
        let hello = json!({ "jsonrpc": "2.0", "id": HELLO_ID, "method": "session.hello",
            "params": { "appId": app_id, "token": token, "apiVersion": "1.0" } });
        if api_wr.write_all(format!("{hello}\n").as_bytes()).await.is_err() {
            return;
        }
        let answer = tokio::time::timeout(Duration::from_secs(5), async {
            while let Ok(Some(l)) = api_rd.next_line().await {
                let v: Value = serde_json::from_str(&l).unwrap_or(Value::Null);
                if v["id"] == HELLO_ID {
                    return Some(v);
                }
            }
            None
        })
        .await
        .ok()
        .flatten();
        let session = match answer {
            Some(v) if v.get("result").is_some() => v["result"].clone(),
            Some(v) => {
                let _ = sock.write_all(&send(403, json!({ "error": "refused", "api": v["error"] }))).await;
                return;
            }
            None => {
                let _ = sock.write_all(&send(503, json!({ "error": "unavailable" }))).await;
                return;
            }
        };
        let sid = crate::api::store::random_id("s_");
        let (tx, mut rx) = mpsc::channel::<String>(RPC_QUEUE);
        self.sessions.lock().unwrap().insert(sid.clone(), Session { app_id, tx });

        let mut first = http::stream_head();
        first.extend(http::event(Some("hello"), &json!({ "session": sid, "hello": session, "serverTime": now_ms() }).to_string()));
        let (mut sock_rd, mut sock_wr) = tokio::io::split(sock);
        if put(&mut sock_wr, &first).await {
            let mut keepalive = tokio::time::interval(KEEPALIVE);
            keepalive.tick().await;
            let mut scratch = [0u8; 256];
            loop {
                tokio::select! {
                    line = api_rd.next_line() => match line {
                        Ok(Some(l)) => if !put(&mut sock_wr, &http::event(None, &l)).await { break },
                        _ => break,
                    },
                    req = rx.recv() => match req {
                        Some(l) => if api_wr.write_all(format!("{l}\n").as_bytes()).await.is_err() { break },
                        None => break,
                    },
                    _ = keepalive.tick() => if !put(&mut sock_wr, b": keepalive\n\n").await { break },
                    // The phone sends nothing more on this connection: any read result means it is gone.
                    _ = sock_rd.read(&mut scratch) => break,
                }
            }
        }
        self.sessions.lock().unwrap().remove(&sid);
        let _ = api_wr.shutdown().await;
    }
}

/// Writes it all, or false when the phone stopped reading or is gone.
async fn put<W: AsyncWrite + Unpin>(w: &mut W, bytes: &[u8]) -> bool {
    matches!(tokio::time::timeout(WRITE_TIMEOUT, w.write_all(bytes)).await, Ok(Ok(())))
}

/// Reads up to the end of the head. Returns it and whatever body bytes came along; None on a malformed or
/// oversized head or a closed connection.
async fn read_head<S: AsyncRead + Unpin>(sock: &mut S) -> Option<(Head, Vec<u8>)> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = sock.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(end) = http::head_end(&buf) {
            let head = http::parse_head(&buf[..end])?;
            return Some((head, buf.split_off(end)));
        }
        if buf.len() > http::MAX_HEAD {
            return None;
        }
    }
}

/// The body, at most `max` bytes, read within the request timeout. Err(status) when it is too big or broken.
async fn read_body<S: AsyncRead + Unpin>(sock: &mut S, head: &Head, mut body: Vec<u8>, max: usize) -> Result<Vec<u8>, u16> {
    let len = head.content_length().ok_or(400u16)?;
    if len > max || body.len() > len {
        return Err(if len > max { 413 } else { 400 });
    }
    let rest = len - body.len();
    let mut more = vec![0u8; rest];
    match tokio::time::timeout(READ_TIMEOUT, sock.read_exact(&mut more)).await {
        Ok(Ok(_)) => {
            body.extend(more);
            Ok(body)
        }
        _ => Err(400),
    }
}

/// A browser on another site may send requests here too; the phone page's own requests come from this origin.
fn same_origin(head: &Head) -> bool {
    match (head.header("origin"), head.header("host")) {
        (None, _) => true,
        (Some(o), Some(h)) => o == format!("http://{h}"),
        (Some(_), None) => false,
    }
}

/// The request as one JSON-RPC line for the API connection. Authentication is Rust's job, so a phone can neither
/// register another app nor start a second session on its stream.
fn rpc_line(body: &[u8]) -> Option<String> {
    let v: Value = serde_json::from_slice(body).ok()?;
    let method = v.get("method")?.as_str()?;
    if matches!(method, "app.register" | "session.hello") {
        return None;
    }
    v.is_object().then(|| v.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::server::Host;

    struct NoHost;
    impl Host for NoHost {
        fn emit(&self, _: &str, _: Value) {}
        fn notify(&self, _: &str, _: &str, _: &str) {}
        fn close_notification(&self, _: &str) {}
    }

    fn remote(name: &str) -> Arc<Remote> {
        let dir = std::env::temp_dir().join(format!("sonolith-remote-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let api = Server::new(Arc::new(NoHost), dir.join("api-apps.json"), "9.9.9".into());
        Remote::new(api, "s3cret-link-value".into(), String::new())
    }

    /// Sends one raw request and returns the whole response (the server closes after it).
    async fn request(r: &Arc<Remote>, raw: String) -> String {
        let (mut ours, theirs) = tokio::io::duplex(64 * 1024);
        tokio::spawn(r.clone().handle(theirs, "192.168.1.30".parse().unwrap()));
        ours.write_all(raw.as_bytes()).await.unwrap();
        let mut out = String::new();
        tokio::time::timeout(Duration::from_secs(5), ours.read_to_string(&mut out)).await.unwrap().unwrap();
        out
    }

    fn post(path: &str, auth: Option<&str>, extra: &str, body: &str) -> String {
        let auth = auth.map(|a| format!("Authorization: Bearer {a}\r\n")).unwrap_or_default();
        format!("POST {path} HTTP/1.1\r\nHost: 10.0.0.2:48765\r\n{auth}{extra}Content-Length: {}\r\n\r\n{body}", body.len())
    }

    fn body(resp: &str) -> Value {
        serde_json::from_str(resp.split("\r\n\r\n").nth(1).unwrap()).unwrap()
    }

    #[tokio::test]
    async fn serves_the_page_with_a_strict_policy() {
        let r = remote("page");
        let page = request(&r, "GET / HTTP/1.1\r\nHost: x\r\n\r\n".into()).await;
        assert!(page.starts_with("HTTP/1.1 200 OK") && page.contains("Content-Security-Policy: default-src 'none'"));
        assert!(request(&r, "GET /secret HTTP/1.1\r\n\r\n".into()).await.starts_with("HTTP/1.1 404"));
        assert!(request(&r, "DELETE / HTTP/1.1\r\n\r\n".into()).await.starts_with("HTTP/1.1 405"));
        assert!(request(&r, format!("GET /{} HTTP/1.1\r\n", "a".repeat(9000))).await.starts_with("HTTP/1.1 431"));
    }

    #[tokio::test]
    async fn pairing_needs_the_secret_and_wrong_guesses_are_limited() {
        let r = remote("pair");
        let wrong = request(&r, post("/api/pair", None, "", r#"{"secret":"nope"}"#)).await;
        assert!(wrong.starts_with("HTTP/1.1 403"), "{wrong}");
        let foreign = request(&r, post("/api/pair", None, "Origin: http://evil.example\r\n", r#"{"secret":"s3cret-link-value"}"#)).await;
        assert!(foreign.starts_with("HTTP/1.1 403"));
        let too_big = request(&r, post("/api/pair", None, "", &"x".repeat(2000))).await;
        assert!(too_big.starts_with("HTTP/1.1 413"));

        let ok = request(&r, post("/api/pair", None, "Origin: http://10.0.0.2:48765\r\nUser-Agent: Android 15 Mobile\r\n", r#"{"secret":"s3cret-link-value"}"#)).await;
        let paired = body(&ok);
        let app_id = paired["appId"].as_str().unwrap();
        assert!(app_id.starts_with("dev.sonolith.remote."));
        assert!(r.api.remote_token_ok(app_id, paired["token"].as_str().unwrap()));
        assert_eq!(r.api.apps()["apps"][0]["name"], "Android phone");
        assert_eq!(r.api.apps()["apps"][0]["scopes"], json!(PAIRED_SCOPES));

        for _ in 0..5 {
            request(&r, post("/api/pair", None, "", r#"{"secret":"nope"}"#)).await;
        }
        let held = request(&r, post("/api/pair", None, "", r#"{"secret":"s3cret-link-value"}"#)).await;
        assert!(held.starts_with("HTTP/1.1 429") && held.contains("Retry-After: "), "{held}");
        // A new link: the old secret no longer pairs, the counts start over.
        r.set_secret("another".into());
        let old = request(&r, post("/api/pair", None, "", r#"{"secret":"s3cret-link-value"}"#)).await;
        assert!(old.starts_with("HTTP/1.1 403"));
    }

    async fn next_data<R: tokio::io::AsyncBufRead + Unpin>(lines: &mut tokio::io::Lines<R>) -> Value {
        loop {
            let l = tokio::time::timeout(Duration::from_secs(5), lines.next_line()).await.unwrap().unwrap().unwrap();
            if let Some(d) = l.strip_prefix("data: ") {
                return serde_json::from_str::<Value>(d).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn a_phone_streams_events_and_sends_requests_within_its_scopes() {
        let r = remote("stream");
        let paired = body(&request(&r, post("/api/pair", None, "", r#"{"secret":"s3cret-link-value"}"#)).await);
        let auth = format!("{}:{}", paired["appId"].as_str().unwrap(), paired["token"].as_str().unwrap());
        assert!(request(&r, "GET /api/stream HTTP/1.1\r\nAuthorization: Bearer x.y.z:snl_bad\r\n\r\n".into()).await.starts_with("HTTP/1.1 401"));

        let (ours, theirs) = tokio::io::duplex(64 * 1024);
        tokio::spawn(r.clone().handle(theirs, "192.168.1.30".parse().unwrap()));
        let (rd, mut wr) = tokio::io::split(ours);
        wr.write_all(format!("GET /api/stream HTTP/1.1\r\nAuthorization: Bearer {auth}\r\n\r\n").as_bytes()).await.unwrap();
        let mut lines = BufReader::new(rd).lines();
        let hello = next_data(&mut lines).await;
        assert_eq!(hello["hello"]["grantedScopes"], json!(PAIRED_SCOPES));
        assert_eq!(hello["hello"]["identity"]["kind"], "remote");
        assert!(hello["serverTime"].as_u64().unwrap() > 0);
        let sid = hello["session"].as_str().unwrap().to_string();

        let call = |body: &str| post("/api/rpc", Some(&auth), &format!("X-Session: {sid}\r\n"), body);
        assert!(request(&r, call(r#"{"jsonrpc":"2.0","id":1,"method":"queue.get","params":{}}"#)).await.starts_with("HTTP/1.1 202"));
        let denied = next_data(&mut lines).await;
        assert_eq!((denied["id"].as_i64(), denied["error"]["data"]["scope"].as_str()), (Some(1), Some("queue:read")));
        // Authentication stays Rust's: these never reach the API connection.
        assert!(request(&r, call(r#"{"jsonrpc":"2.0","id":2,"method":"app.register","params":{}}"#)).await.starts_with("HTTP/1.1 400"));
        let wrong_session = post("/api/rpc", Some(&auth), "X-Session: s_other\r\n", r#"{"jsonrpc":"2.0","id":3,"method":"app.info"}"#);
        assert!(request(&r, wrong_session).await.starts_with("HTTP/1.1 409"));

        // Unpairing (a new link) ends the stream with `session.revoked`.
        r.api.remove_remote_apps();
        assert_eq!(next_data(&mut lines).await["method"], "session.revoked");
    }

    #[test]
    fn requests_are_single_objects_without_auth_methods() {
        let line = rpc_line(b"{\"jsonrpc\":\"2.0\",\n\"id\":1,\"method\":\"player.next\"}").unwrap();
        assert!(!line.contains('\n'));
        assert_eq!(serde_json::from_str::<Value>(&line).unwrap(), json!({ "jsonrpc": "2.0", "id": 1, "method": "player.next" }));
        assert!(rpc_line(br#"[{"method":"player.next"}]"#).is_none());
        assert!(rpc_line(br#"{"method":"session.hello"}"#).is_none());
        assert!(rpc_line(b"not json").is_none());
    }
}
