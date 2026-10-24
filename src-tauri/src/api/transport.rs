//! The endpoint: a Unix domain socket (Linux) or a named pipe (Windows), and the discovery file next to it.

use super::protocol::API_VERSION;
use super::server::{now_ms, Server};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;

pub struct Endpoint {
    /// The socket path or the full pipe name.
    pub path: String,
    discovery: PathBuf,
    #[cfg(unix)]
    socket: PathBuf,
}

impl Endpoint {
    /// Removes the socket and the discovery file (only when it still names us).
    pub fn cleanup(&self) {
        let ours = std::fs::read_to_string(&self.discovery)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .is_some_and(|d| d["pid"] == std::process::id());
        if ours {
            let _ = std::fs::remove_file(&self.discovery);
        }
        #[cfg(unix)]
        let _ = std::fs::remove_file(&self.socket);
    }
}

fn write_discovery(path: &std::path::Path, transport: &str, endpoint: &str, app_version: &str) -> std::io::Result<()> {
    let body = json!({
        "apiVersion": API_VERSION,
        "appVersion": app_version,
        "transport": transport,
        "path": endpoint,
        "pid": std::process::id(),
        "startedAt": now_ms(),
    });
    let tmp = path.with_extension("json.tmp");
    write_private(&tmp, serde_json::to_string_pretty(&body).unwrap().as_bytes())?;
    std::fs::rename(tmp, path)
}

#[cfg(unix)]
fn write_private(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    f.write_all(data)
}

#[cfg(windows)]
fn write_private(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    std::fs::write(path, data)
}

/// Expires unanswered consent requests once a second while the endpoint is up.
async fn expiry_ticker(server: Arc<Server>) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        tick.tick().await;
        server.expire();
    }
}

// ---------------------------------------------------------------- Linux

/// `$XDG_RUNTIME_DIR/sonolith`, or `/tmp/sonolith-<uid>` without it. Created private; refused if it is not.
#[cfg(unix)]
pub fn runtime_dir() -> std::io::Result<PathBuf> {
    use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
    let uid = std::fs::metadata("/proc/self")?.uid();
    let dir = match std::env::var("XDG_RUNTIME_DIR") {
        Ok(x) if !x.is_empty() => PathBuf::from(x).join("sonolith"),
        _ => PathBuf::from(format!("/tmp/sonolith-{uid}")),
    };
    match std::fs::DirBuilder::new().mode(0o700).create(&dir) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e),
    }
    let meta = std::fs::symlink_metadata(&dir)?;
    if !meta.is_dir() || meta.uid() != uid {
        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, format!("{} is not ours", dir.display())));
    }
    if meta.mode() & 0o077 != 0 {
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(dir)
}

#[cfg(unix)]
pub async fn start(server: Arc<Server>, app_version: &str) -> std::io::Result<(Endpoint, tauri::async_runtime::JoinHandle<()>)> {
    use std::os::unix::fs::PermissionsExt;
    let dir = runtime_dir()?;
    let socket = dir.join("api.sock");
    if socket.exists() {
        // A live socket means another Sonolith serves it; a dead one is left over from a crash.
        if std::os::unix::net::UnixStream::connect(&socket).is_ok() {
            return Err(std::io::Error::new(std::io::ErrorKind::AddrInUse, "another Sonolith is serving the API"));
        }
        std::fs::remove_file(&socket)?;
    }
    let listener = tokio::net::UnixListener::bind(&socket)?;
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))?;
    let discovery = dir.join("discovery.json");
    let path = socket.to_string_lossy().into_owned();
    write_discovery(&discovery, "unix", &path, app_version)?;
    let task = tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = accept_unix(listener, server.clone()) => {}
            _ = expiry_ticker(server) => {}
        }
    });
    Ok((Endpoint { path, discovery, socket }, task))
}

/// Serves every connection to the socket, each with the peer the kernel reports. Only the credentials are read here;
/// looking at the process (/proc) happens off this loop, so a peer that is slow to inspect holds up nobody else.
#[cfg(unix)]
pub(super) async fn accept_unix(listener: tokio::net::UnixListener, server: Arc<Server>) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            continue;
        };
        let cred = stream.peer_cred().ok();
        let peer = move || super::peer::unix_peer(cred);
        let hangup = hangup(std::os::fd::AsRawFd::as_raw_fd(&stream));
        tokio::spawn(server.clone().serve(stream, peer, hangup));
    }
}

/// Resolves when the peer has closed both directions (POLLHUP), which end of input alone does not tell. `serve`
/// owns the stream and drops this future before the stream, so the fd stays ours while it is polled.
#[cfg(unix)]
async fn hangup(fd: std::os::fd::RawFd) {
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        let mut p = libc::pollfd { fd, events: 0, revents: 0 };
        // SAFETY: one valid pollfd, zero timeout.
        if unsafe { libc::poll(&mut p, 1, 0) } > 0 && p.revents & (libc::POLLHUP | libc::POLLERR | libc::POLLNVAL) != 0 {
            return;
        }
    }
}

// ---------------------------------------------------------------- Windows

#[cfg(windows)]
pub async fn start(server: Arc<Server>, app_version: &str) -> std::io::Result<(Endpoint, tauri::async_runtime::JoinHandle<()>)> {
    use super::win::{default_pipe_name, pipe_client_pid, process, UserOnly};
    let attrs = UserOnly::new()?;
    let mut name = default_pipe_name();
    // Someone else holds the name: take a random one; clients read it from discovery.json.
    let first = match attrs.create(&name, true) {
        Ok(p) => p,
        Err(_) => {
            name = format!("{name}-{}", super::store::random_id("").to_lowercase().replace(['-', '_'], ""));
            attrs.create(&name, true)?
        }
    };
    let dir = PathBuf::from(std::env::var("LOCALAPPDATA").map_err(std::io::Error::other)?).join("Sonolith").join("api");
    std::fs::create_dir_all(&dir)?;
    let discovery = dir.join("discovery.json");
    write_discovery(&discovery, "pipe", &name, app_version)?;
    let pipe_name = name.clone();
    let task = tauri::async_runtime::spawn(async move {
        let ticker = expiry_ticker(server.clone());
        let accept = async move {
        let mut next = first;
        loop {
            if next.connect().await.is_err() {
                match attrs.create(&pipe_name, false) {
                    Ok(p) => next = p,
                    Err(_) => tokio::time::sleep(std::time::Duration::from_millis(500)).await,
                }
                continue;
            }
            let connected = next;
            next = loop {
                match attrs.create(&pipe_name, false) {
                    Ok(p) => break p,
                    Err(_) => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
                }
            };
            let pid = pipe_client_pid(&connected);
            let peer = move || pid.ok_or(super::peer::PeerError::Unknown).and_then(process);
            // A pipe cannot be half-closed: end of input means the client is gone.
            tokio::spawn(server.clone().serve(connected, peer, std::future::ready(())));
        }
        };
        tokio::select! {
            _ = accept => {}
            _ = ticker => {}
        }
    });
    Ok((Endpoint { path: name, discovery }, task))
}
