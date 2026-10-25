//! The local API for other apps (api/SPEC.md): off by default, turned on in Settings → Connected apps.
//!
//! Rust owns the endpoint, registration and consent, tokens, scopes, rate limits and event fan-out. Data that lives
//! in the frontend (YouTube calls, the queue, lyrics) goes through one bridge: `api:call` events out, `api_reply`
//! back, matched by id with a timeout. The frontend also publishes player, queue, account and lyrics state with
//! `api_publish`, so the server answers `player.getState` and computes position and lyric timing itself, which
//! keeps working while the window is hidden.

pub mod identity;
mod methods;
mod notify;
mod peer;
mod protocol;
pub mod server;
mod store;
#[cfg(all(test, target_os = "linux"))]
mod tests;
mod transport;
mod validate;
#[cfg(windows)]
mod win;

use serde::Deserialize;
use serde_json::{json, Value};
use server::{Decision, Host, Server};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

const ENABLED_KEY: &str = "api_enabled";

struct Running {
    endpoint: transport::Endpoint,
    task: tauri::async_runtime::JoinHandle<()>,
}

pub struct ApiState {
    server: OnceLock<Arc<Server>>,
    running: tokio::sync::Mutex<Option<Running>>,
    error: std::sync::Mutex<Option<String>>,
}

struct TauriHost {
    app: AppHandle,
    notes: notify::Notifications,
}

impl Host for TauriHost {
    fn emit(&self, event: &str, payload: Value) {
        let _ = self.app.emit(event, payload);
    }
    fn notify(&self, request_id: &str, title: &str, body: &str) {
        self.notes.show(&self.app, request_id, title, body);
        if let Some(w) = self.app.get_webview_window("main") {
            let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
    }
    fn close_notification(&self, request_id: &str) {
        self.notes.close(request_id);
    }
}

fn server(app: &AppHandle) -> Arc<Server> {
    let state = app.state::<ApiState>();
    state
        .server
        .get_or_init(|| {
            let path = app.path().app_data_dir().unwrap_or_default().join("api-apps.json");
            let host = Arc::new(TauriHost { app: app.clone(), notes: notify::Notifications::default() });
            Server::new(host, path, app.package_info().version.to_string())
        })
        .clone()
}

/// Registers the state and starts the endpoint when the API is on.
pub fn init(app: &AppHandle) {
    app.manage(ApiState { server: OnceLock::new(), running: tokio::sync::Mutex::new(None), error: Default::default() });
    if crate::render::flag(app, ENABLED_KEY, false) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = set_running(&app, true).await;
        });
    }
}

/// Removes the socket and discovery file on quit.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<ApiState>() {
        if let Ok(mut r) = state.running.try_lock() {
            if let Some(r) = r.take() {
                r.task.abort();
                r.endpoint.cleanup();
            }
        }
    }
}

async fn set_running(app: &AppHandle, on: bool) -> Result<(), String> {
    let server = server(app);
    let state = app.state::<ApiState>();
    let mut running = state.running.lock().await;
    if on && running.is_none() {
        match transport::start(server, &app.package_info().version.to_string()).await {
            Ok((endpoint, task)) => {
                *running = Some(Running { endpoint, task });
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
            r.endpoint.cleanup();
        }
        server.close_all();
    }
    Ok(())
}

async fn status(app: &AppHandle) -> Value {
    let state = app.state::<ApiState>();
    let path = state.running.lock().await.as_ref().map(|r| r.endpoint.path.clone());
    let error = state.error.lock().unwrap().clone();
    json!({
        "enabled": crate::render::flag(app, ENABLED_KEY, false),
        "running": path.is_some(),
        "path": path,
        "error": error,
    })
}

#[tauri::command]
pub async fn api_status(app: AppHandle) -> Value {
    status(&app).await
}

#[tauri::command]
pub async fn api_set_enabled(app: AppHandle, enabled: bool) -> Result<Value, String> {
    crate::render::write_flag(&app, ENABLED_KEY, enabled)?;
    let result = set_running(&app, enabled).await;
    let s = status(&app).await;
    result.map(|_| s)
}

/// The frontend bridge is listening. Returns what it must catch up on after a (re)load.
#[tauri::command]
pub async fn api_ready(app: AppHandle) -> Value {
    let s = server(&app);
    s.frontend_ready(true);
    json!({ "lyricsWanted": s.lyrics_wanted(), "consents": s.open_consents() })
}

#[tauri::command]
pub async fn api_reply(app: AppHandle, id: u64, result: Option<Value>, error: Option<Value>) {
    server(&app).bridge_reply(id, result, error);
}

#[tauri::command]
pub async fn api_publish(app: AppHandle, kind: String, payload: Value) {
    server(&app).publish(&kind, payload);
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Answer {
    Allow,
    Deny,
    Block,
}

#[tauri::command]
pub async fn api_consent_answer(app: AppHandle, request_id: String, decision: Answer, scopes: Vec<String>) -> Result<(), String> {
    let d = match decision {
        Answer::Allow => Decision::Allow,
        Answer::Deny => Decision::Deny,
        Answer::Block => Decision::Block,
    };
    server(&app).resolve(&request_id, d, &scopes)
}

#[tauri::command]
pub async fn api_apps(app: AppHandle) -> Value {
    server(&app).apps()
}

#[tauri::command]
pub async fn api_remove_app(app: AppHandle, app_id: String) {
    server(&app).remove_app(&app_id);
}

#[tauri::command]
pub async fn api_remove_all(app: AppHandle) {
    server(&app).remove_all();
}

#[tauri::command]
pub async fn api_revoke_scope(app: AppHandle, app_id: String, scope: String) {
    server(&app).revoke_scope(&app_id, &scope);
}

#[tauri::command]
pub async fn api_block(app: AppHandle, app_id: String) {
    server(&app).block_app(&app_id);
}

#[tauri::command]
pub async fn api_allow_asking_again(app: AppHandle, app_id: String) {
    server(&app).allow_asking_again(&app_id);
}

#[tauri::command]
pub async fn api_unblock(app: AppHandle, app_id: String) {
    server(&app).unblock(&app_id);
}
