//! "Use GPU for rendering" setting: WebKitGTK hardware acceleration on/off (persisted in config.json).
//! Off = pure CPU rasterisation, so the app never touches the GPU (useful while gaming).
use tauri::{AppHandle, Manager};

const KEY: &str = "gpu_rendering";

fn config_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("config.json"))
}

fn read_config(app: &AppHandle) -> serde_json::Value {
    config_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn flag(app: &AppHandle, key: &str, default: bool) -> bool {
    read_config(app).get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

fn write_flag(app: &AppHandle, key: &str, value: bool) -> Result<(), String> {
    let path = config_path(app).ok_or("no config dir")?;
    let mut cfg = read_config(app);
    cfg[key] = serde_json::Value::Bool(value);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(path, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())
}

pub fn gpu_enabled(app: &AppHandle) -> bool {
    flag(app, KEY, true)
}

/// Close button hides the window to the tray instead of quitting (default on).
pub fn close_to_tray(app: &AppHandle) -> bool {
    flag(app, "close_to_tray", true)
}

#[tauri::command(async)]
pub fn render_get_close_to_tray(app: AppHandle) -> bool {
    close_to_tray(&app)
}

#[tauri::command(async)]
pub fn render_set_close_to_tray(app: AppHandle, enabled: bool) -> Result<(), String> {
    write_flag(&app, "close_to_tray", enabled)
}

/// Applies the policy to every webview window.
pub fn apply(app: &AppHandle, gpu: bool) {
    for w in app.webview_windows().values() {
        let _ = w.with_webview(move |wv| {
            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};
                if let Some(settings) = wv.inner().settings() {
                    settings.set_hardware_acceleration_policy(if gpu {
                        HardwareAccelerationPolicy::Always
                    } else {
                        HardwareAccelerationPolicy::Never
                    });
                }
            }
            #[cfg(not(target_os = "linux"))]
            let _ = (wv, gpu);
        });
    }
}

#[tauri::command(async)]
pub fn render_get_gpu(app: AppHandle) -> bool {
    gpu_enabled(&app)
}

#[tauri::command(async)]
pub fn render_set_gpu(app: AppHandle, enabled: bool) -> Result<(), String> {
    write_flag(&app, KEY, enabled)?;
    apply(&app, enabled);
    Ok(())
}

/// Whether an earlier ytdesk left data on disk: its config.json (GPU, close to tray, yt-dlp path) or a yt-dlp it
/// downloaded. Taken once in setup, before the yt-dlp auto-install creates `bin/`: asked later, a fresh install
/// already looks like an existing one.
pub struct PriorData(pub bool);

pub fn prior_data_on_disk(app: &AppHandle) -> bool {
    let config = config_path(app).is_some_and(|p| p.exists());
    let ytdlp = app.path().app_data_dir().ok().is_some_and(|d| d.join("bin").exists());
    config || ytdlp
}

/// The first-run onboarding counts prior data on disk as an existing install (along with stored settings and cookie).
#[tauri::command]
pub fn app_has_prior_data(prior: tauri::State<'_, PriorData>) -> bool {
    prior.0
}
