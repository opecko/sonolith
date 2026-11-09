//! Phone remote: control Sonolith from a phone's browser on the same network (Settings → Phone remote).
//!
//! Off by default. Once on, it starts with Sonolith until it is turned off. The link (shown with a QR code) carries a
//! secret in its fragment; a phone that presents it is registered as a local API client with the player scopes
//! (bridge.rs). A new link rotates the secret and unpairs every phone. Plain HTTP on the LAN: Settings says so.

mod bridge;
mod guard;
mod http;
mod qr;
mod theme;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

const ENABLED_KEY: &str = "remote_enabled";
/// The port tried first, so the link stays the same between starts; another one is picked when it is taken.
const DEFAULT_PORT: u16 = 48765;

/// What is kept in `remote.json` (private to the user: the secret pairs phones).
#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    secret: String,
    port: u16,
}

struct Running {
    remote: Arc<bridge::Remote>,
    port: u16,
    task: tauri::async_runtime::JoinHandle<()>,
}

pub struct RemoteState {
    running: tokio::sync::Mutex<Option<Running>>,
    error: Mutex<Option<String>>,
    theme_css: Mutex<String>,
}

/// None without an app data directory: the secret is never written anywhere else (such as the working directory).
fn saved_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("remote.json"))
}

fn load(app: &AppHandle) -> Saved {
    if let Some(s) = saved_path(app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str::<Saved>(&t).ok()) {
        if s.secret.len() >= 32 {
            return s;
        }
    }
    let s = Saved { secret: guard::new_secret(), port: DEFAULT_PORT };
    let _ = save(app, &s);
    s
}

fn save(app: &AppHandle, s: &Saved) -> std::io::Result<()> {
    let path = saved_path(app).ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no app data directory"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    crate::api::store::write_private(&path, serde_json::to_string_pretty(s).unwrap().as_bytes())
}

/// The address other devices reach this computer at: the one the default route leaves from (a UDP "connect" sends
/// nothing). None without a network.
fn lan_ip() -> Option<std::net::IpAddr> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?;
    let ip = s.local_addr().ok()?.ip();
    (!ip.is_unspecified() && !ip.is_loopback()).then_some(ip)
}

/// The pairing link. The secret sits in the fragment, which browsers never send: the page posts it once to pair.
fn link(ip: std::net::IpAddr, port: u16, secret: &str) -> String {
    format!("http://{ip}:{port}/#k={secret}")
}

/// Registers the state and starts the listener when the remote is on.
pub fn init(app: &AppHandle) {
    app.manage(RemoteState { running: tokio::sync::Mutex::new(None), error: Mutex::new(None), theme_css: Mutex::new(String::new()) });
    if crate::render::flag(app, ENABLED_KEY, false) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = set_running(&app, true).await;
        });
    }
}

/// Binds the saved port, or any free one (saved for next time) when it is taken.
async fn bind(app: &AppHandle, saved: &mut Saved) -> std::io::Result<tokio::net::TcpListener> {
    match tokio::net::TcpListener::bind(("0.0.0.0", saved.port)).await {
        Ok(l) => Ok(l),
        Err(_) => {
            let l = tokio::net::TcpListener::bind(("0.0.0.0", 0)).await?;
            saved.port = l.local_addr()?.port();
            let _ = save(app, saved);
            Ok(l)
        }
    }
}

async fn set_running(app: &AppHandle, on: bool) -> Result<(), String> {
    let state = app.state::<RemoteState>();
    let mut running = state.running.lock().await;
    if on && running.is_none() {
        let mut saved = load(app);
        match bind(app, &mut saved).await {
            Ok(listener) => {
                let api = crate::api::server(app);
                let remote = bridge::Remote::new(api.clone(), saved.secret.clone(), state.theme_css.lock().unwrap().clone());
                let task = tauri::async_runtime::spawn({
                    let remote = remote.clone();
                    async move {
                        // Consent requests from phones expire even while the API for other apps is off.
                        let ticker = async {
                            let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
                            loop {
                                tick.tick().await;
                                api.expire();
                            }
                        };
                        tokio::select! {
                            _ = remote.listen(listener) => {}
                            _ = ticker => {}
                        }
                    }
                });
                *running = Some(Running { remote, port: saved.port, task });
                *state.error.lock().unwrap() = None;
            }
            Err(e) => {
                let msg = e.to_string();
                *state.error.lock().unwrap() = Some(msg.clone());
                return Err(msg);
            }
        }
    } else if !on {
        if let Some(r) = running.take() {
            r.task.abort();
        }
        crate::api::server(app).close_remote();
    }
    Ok(())
}

async fn status(app: &AppHandle) -> Value {
    let state = app.state::<RemoteState>();
    let port = state.running.lock().await.as_ref().map(|r| r.port);
    let ip = lan_ip();
    let url = match (port, ip) {
        (Some(port), Some(ip)) => Some(link(ip, port, &load(app).secret)),
        _ => None,
    };
    let (paired, connected) = crate::api::server(app).remote_counts();
    json!({
        "enabled": crate::render::flag(app, ENABLED_KEY, false),
        "running": port.is_some(),
        "url": url,
        "qrSvg": url.as_deref().and_then(qr::svg),
        "noNetwork": port.is_some() && ip.is_none(),
        "paired": paired,
        "connected": connected,
        "error": state.error.lock().unwrap().clone(),
    })
}

#[tauri::command]
pub async fn remote_status(app: AppHandle) -> Value {
    status(&app).await
}

#[tauri::command]
pub async fn remote_set_enabled(app: AppHandle, enabled: bool) -> Result<Value, String> {
    crate::render::write_flag(&app, ENABLED_KEY, enabled)?;
    let result = set_running(&app, enabled).await;
    let s = status(&app).await;
    result.map(|_| s)
}

/// A new link: a new secret, and every paired phone is unpaired.
#[tauri::command]
pub async fn remote_new_link(app: AppHandle) -> Result<Value, String> {
    let mut saved = load(&app);
    saved.secret = guard::new_secret();
    save(&app, &saved).map_err(|e| e.to_string())?;
    if let Some(r) = app.state::<RemoteState>().running.lock().await.as_ref() {
        r.remote.set_secret(saved.secret.clone());
    }
    crate::api::server(&app).remove_remote_apps();
    Ok(status(&app).await)
}

/// The app's current colors for the phone page (only known tokens with hex values are kept).
#[tauri::command]
pub async fn remote_theme(app: AppHandle, tokens: BTreeMap<String, String>, light: bool) {
    let state = app.state::<RemoteState>();
    let css = theme::css(&theme::accept(&tokens), light);
    *state.theme_css.lock().unwrap() = css.clone();
    let running = state.running.lock().await;
    if let Some(r) = running.as_ref() {
        r.remote.set_theme(css);
    }
}

/// Stops the listener on quit.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<RemoteState>() {
        if let Ok(mut r) = state.running.try_lock() {
            if let Some(r) = r.take() {
                r.task.abort();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_secret_rides_in_the_fragment() {
        let l = link("192.168.1.10".parse().unwrap(), 48765, "abc");
        assert_eq!(l, "http://192.168.1.10:48765/#k=abc");
        let u = url::Url::parse(&l).unwrap();
        // What a browser sends in the request line: no secret.
        assert_eq!(&u[..url::Position::AfterQuery], "http://192.168.1.10:48765/");
    }
}
