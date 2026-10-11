//! Discord Rich Presence over the local Discord IPC socket (no SDK, no secrets: the application id is public).
//! A worker thread owns the connection, reconnects when Discord (or Vesktop's arRPC) starts later, and always
//! reflects the latest activity the frontend sent.
use std::io::{Read, Write};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

/// Public Discord application id ("ytdesk").
const CLIENT_ID: &str = "1556215776350961704";
/// How often to retry when Discord isn't running yet.
const RETRY: Duration = Duration::from_secs(5);

enum Msg {
    Set(Option<Value>),
    Disconnect,
}

static TX: OnceLock<Mutex<Sender<Msg>>> = OnceLock::new();

fn sender() -> Sender<Msg> {
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new().name("discord-rpc".into()).spawn(move || worker(rx)).expect("spawn discord worker");
        Mutex::new(tx)
    })
    .lock()
    .unwrap()
    .clone()
}

// ---------- transport ----------

#[cfg(unix)]
type Stream = std::os::unix::net::UnixStream;
#[cfg(windows)]
type Stream = std::fs::File;

#[cfg(unix)]
fn candidates() -> Vec<std::path::PathBuf> {
    let mut bases: Vec<std::path::PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
        .iter()
        .filter_map(|k| std::env::var_os(k).map(Into::into))
        .collect();
    bases.push("/tmp".into());
    // TMPDIR is often /tmp itself.
    let mut seen = std::collections::HashSet::new();
    bases.retain(|b| seen.insert(b.clone()));
    // Native, Flatpak, Snap and Vesktop (Flatpak) locations of discord-ipc-N.
    let subs = [
        "",
        "app/com.discordapp.Discord",
        "app/com.discordapp.DiscordCanary",
        "app/dev.vencord.Vesktop",
        ".flatpak/dev.vencord.Vesktop/xdg-run",
        ".flatpak/com.discordapp.Discord/xdg-run",
        "snap.discord",
        "snap.discord-canary",
    ];
    let mut out = Vec::new();
    for b in &bases {
        for s in subs {
            // One stat instead of ten failed connects for every location Discord doesn't use (retried every 5 s
            // while Discord isn't running).
            let dir = b.join(s);
            if !dir.is_dir() {
                continue;
            }
            for i in 0..10 {
                out.push(dir.join(format!("discord-ipc-{i}")));
            }
        }
    }
    out
}

#[cfg(unix)]
fn open() -> Option<Stream> {
    candidates().into_iter().find_map(|p| {
        let s = Stream::connect(p).ok()?;
        s.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
        s.set_write_timeout(Some(Duration::from_secs(5))).ok()?;
        Some(s)
    })
}

#[cfg(windows)]
fn open() -> Option<Stream> {
    (0..10).find_map(|i| std::fs::OpenOptions::new().read(true).write(true).open(format!(r"\\.\pipe\discord-ipc-{i}")).ok())
}

/// Frame: little-endian u32 opcode, u32 length, JSON payload.
fn encode(op: u32, payload: &Value) -> Vec<u8> {
    let body = payload.to_string().into_bytes();
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    buf
}

fn read_frame(s: &mut Stream) -> std::io::Result<(u32, Value)> {
    let mut head = [0u8; 8];
    s.read_exact(&mut head)?;
    let op = u32::from_le_bytes(head[..4].try_into().unwrap());
    let len = u32::from_le_bytes(head[4..].try_into().unwrap()) as usize;
    if len > 1 << 20 {
        return Err(std::io::Error::other("frame too large"));
    }
    let mut body = vec![0u8; len];
    s.read_exact(&mut body)?;
    Ok((op, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;

/// A live connection. Replies are drained by a reader thread so sending never waits on Discord (or arRPC,
/// which may answer late or not at all); the reader flags the connection dead when Discord goes away.
struct Conn {
    stream: Stream,
    alive: Arc<AtomicBool>,
}

fn connect() -> Option<Conn> {
    let mut s = open()?;
    s.write_all(&encode(OP_HANDSHAKE, &json!({ "v": 1, "client_id": CLIENT_ID }))).ok()?;
    match read_frame(&mut s) {
        Ok((OP_FRAME, v)) if v["evt"] == "READY" => {}
        _ => return None,
    }
    #[cfg(unix)]
    s.set_read_timeout(None).ok()?;
    let mut reader = s.try_clone().ok()?;
    let alive = Arc::new(AtomicBool::new(true));
    let flag = alive.clone();
    std::thread::Builder::new()
        .name("discord-rpc-read".into())
        .spawn(move || {
            loop {
                match read_frame(&mut reader) {
                    Ok((OP_CLOSE, _)) | Err(_) => break,
                    Ok((_, v)) if v["evt"] == "ERROR" => eprintln!("discord rpc: {}", v["data"]["message"]),
                    Ok(_) => {}
                }
            }
            flag.store(false, Ordering::Relaxed);
        })
        .ok()?;
    Some(Conn { stream: s, alive })
}

static NONCE: AtomicU64 = AtomicU64::new(1);

fn set_activity(s: &mut Stream, activity: &Option<Value>) -> std::io::Result<()> {
    let nonce = NONCE.fetch_add(1, Ordering::Relaxed).to_string();
    let payload = json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": activity },
        "nonce": nonce,
    });
    s.write_all(&encode(OP_FRAME, &payload))
}

/// Sends on the current connection; if it's dead, reconnects right away and tries once more.
fn deliver(conn: &mut Option<Conn>, activity: &Option<Value>) -> bool {
    for _ in 0..2 {
        if conn.as_ref().is_some_and(|c| !c.alive.load(Ordering::Relaxed)) {
            *conn = None;
        }
        if conn.is_none() {
            if activity.is_none() {
                return true; // nothing to clear when we're not connected
            }
            *conn = connect();
        }
        let Some(c) = conn.as_mut() else { return false }; // Discord not running
        if set_activity(&mut c.stream, activity).is_ok() {
            return true;
        }
        *conn = None;
    }
    false
}

// ---------- worker ----------

fn worker(rx: Receiver<Msg>) {
    let mut conn: Option<Conn> = None;
    // Latest activity not yet delivered (Discord not running yet); retried every RETRY.
    let mut pending: Option<Option<Value>> = None;
    loop {
        // Nothing to retry: sleep until a message comes instead of waking every RETRY.
        let next = if pending.is_some() { rx.recv_timeout(RETRY) } else { rx.recv().map_err(|_| RecvTimeoutError::Disconnected) };
        match next {
            Ok(Msg::Set(a)) => pending = Some(a),
            Ok(Msg::Disconnect) => {
                if let Some(mut c) = conn.take() {
                    let _ = set_activity(&mut c.stream, &None);
                }
                pending = None;
                continue;
            }
            Err(RecvTimeoutError::Timeout) if pending.is_none() => continue,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        // Coalesce bursts: only the newest activity matters.
        while let Ok(m) = rx.try_recv() {
            match m {
                Msg::Set(a) => pending = Some(a),
                Msg::Disconnect => {
                    conn = None;
                    pending = None;
                }
            }
        }
        if let Some(activity) = pending.take() {
            if !deliver(&mut conn, &activity) {
                pending = Some(activity);
            }
        }
    }
}

/// Sets (Some) or clears (None) the Rich Presence activity. The JSON is a Discord activity object.
#[tauri::command]
pub fn discord_set(activity: Option<Value>) {
    let _ = sender().send(Msg::Set(activity));
}

/// Clears the activity and closes the connection (RPC turned off in Settings).
#[tauri::command]
pub fn discord_disconnect() {
    if TX.get().is_some() {
        let _ = sender().send(Msg::Disconnect);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let buf = encode(OP_FRAME, &json!({ "a": 1 }));
        assert_eq!(&buf[..4], &1u32.to_le_bytes());
        assert_eq!(u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize, buf.len() - 8);
        assert_eq!(serde_json::from_slice::<Value>(&buf[8..]).unwrap(), json!({ "a": 1 }));
    }

    #[cfg(unix)]
    #[test]
    fn talks_to_a_fake_discord() {
        use std::os::unix::net::UnixListener;
        let dir = std::env::temp_dir().join(format!("ytdesk-ipc-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("discord-ipc-0");
        let _ = std::fs::remove_file(&path);
        let listener = UnixListener::bind(&path).unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let (op, hello) = read_frame(&mut s).unwrap();
            assert_eq!((op, hello["client_id"].as_str()), (OP_HANDSHAKE, Some(CLIENT_ID)));
            s.write_all(&encode(OP_FRAME, &json!({ "evt": "READY" }))).unwrap();
            let (_, cmd) = read_frame(&mut s).unwrap();
            s.write_all(&encode(OP_FRAME, &json!({ "evt": null, "cmd": "SET_ACTIVITY" }))).unwrap();
            cmd
        });
        let mut s = Stream::connect(&path).unwrap();
        s.write_all(&encode(OP_HANDSHAKE, &json!({ "v": 1, "client_id": CLIENT_ID }))).unwrap();
        assert_eq!(read_frame(&mut s).unwrap().1["evt"], "READY");
        set_activity(&mut s, &Some(json!({ "type": 2, "details": "Song" }))).unwrap();
        let cmd = server.join().unwrap();
        assert_eq!(read_frame(&mut s).unwrap().1["cmd"], "SET_ACTIVITY"); // reply is left for the reader thread
        assert_eq!(cmd["cmd"], "SET_ACTIVITY");
        assert_eq!(cmd["args"]["activity"]["type"], 2);
        let _ = std::fs::remove_dir_all(dir);
    }
}
