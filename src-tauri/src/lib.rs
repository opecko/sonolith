mod auth;
mod discord;
mod fonts;
#[cfg(target_os = "linux")]
mod mpris;
mod proxy;
mod render;
mod tray;
mod update;
mod ytdlp;

use std::io::Write;
use tauri::Manager;

/// Appends one line to debug/playback.log (repo root in dev builds, app log dir in release).
#[tauri::command(async)]
fn log_playback(app: tauri::AppHandle, line: String) -> Result<String, String> {
    let path = if cfg!(debug_assertions) {
        std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../debug/playback.log"))
    } else {
        app.path().app_log_dir().map_err(|e| e.to_string())?.join("playback.log")
    };
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    writeln!(f, "{ts} {}", line.replace('\n', " | ")).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(target_os = "linux")]
use mpris::mpris_update;

/// Other platforms use the webview's Media Session (SMTC / Now Playing); nothing to export.
#[cfg(not(target_os = "linux"))]
#[tauri::command]
fn mpris_update(_snapshot: serde_json::Value) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin: a second launch (e.g. from the app launcher while hidden in the tray) hands over
        // to the running instance and just shows its window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_window(app)))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            ytdlp::ensure_fresh(app.handle().clone());
            #[cfg(target_os = "linux")]
            mpris::init(app.handle());
            if let Err(e) = tray::init(app.handle()) {
                eprintln!("tray unavailable: {e}");
            }
            if !render::gpu_enabled(app.handle()) {
                render::apply(app.handle(), false);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Close button of the MAIN window hides to the tray (music keeps playing) unless turned off.
            // Other windows (the Google sign-in window) must close normally.
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if render::close_to_tray(app) && app.tray_by_id(tray::TRAY_ID).is_some() {
                    api.prevent_close();
                    tray::hide_window(app);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            log_playback,
            mpris_update,
            discord::discord_set,
            discord::discord_disconnect,
            render::render_get_gpu,
            render::render_get_close_to_tray,
            render::render_set_close_to_tray,
            tray::tray_update,
            render::render_set_gpu,
            proxy::proxy_url,
            proxy::stream_probe,
            ytdlp::ytdlp_status,
            ytdlp::ytdlp_install,
            ytdlp::ytdlp_update,
            ytdlp::ytdlp_set_path,
            auth::auth_get_cookie,
            auth::auth_set_cookie,
            auth::auth_clear,
            auth::auth_login,
            ytdlp::ytdlp_stream_url,
            update::update_check,
            update::update_changelog,
            update::update_open_page,
            update::open_credit,
            fonts::fonts_list,
            update::update_install,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn media_key_names_parse() {
        for k in ["MediaPlayPause", "MediaTrackNext", "MediaTrackPrevious"] {
            assert!(Shortcut::from_str(k).is_ok(), "{k}");
        }
    }
}
