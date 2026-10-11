use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const DEFAULT_BIN: &str = "yt-dlp";
const UPDATE_EVERY: Duration = Duration::from_secs(7 * 24 * 3600);
const RELEASE_BASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";

/// `Command` that never opens a console window on Windows (yt-dlp.exe is a console program).
fn command(bin: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn valid_video_id(id: &str) -> bool {
    (6..=20).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn format_selector(codecs: &[String]) -> Result<String, String> {
    let parts: Vec<&str> = codecs
        .iter()
        .map(|c| match c.as_str() {
            "opus" => Ok("bestaudio[acodec=opus]"),
            "aac" => Ok("bestaudio[acodec^=mp4a]"),
            other => Err(format!("unknown codec {other}")),
        })
        .collect::<Result<_, _>>()?;
    if parts.is_empty() {
        return Err("no playable audio codec".into());
    }
    Ok(parts.join("/"))
}

fn first_url(stdout: &str) -> Option<String> {
    stdout.lines().map(str::trim).find(|l| l.starts_with("http")).map(str::to_owned)
}

/// Keeps the useful part of yt-dlp's stderr: every ERROR line plus the last few lines, capped.
fn error_summary(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let mut keep: Vec<&str> = lines.iter().copied().filter(|l| l.starts_with("ERROR")).collect();
    for l in lines.iter().rev().take(4).rev() {
        if !keep.contains(l) {
            keep.push(l);
        }
    }
    let s = keep.join("\n");
    if s.is_empty() { "unknown error (no output)".into() } else { s.chars().take(2000).collect() }
}

// ---------- binary location ----------

fn asset_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else {
        "yt-dlp_linux"
    }
}

fn managed_path(app: &AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
    app.path().app_data_dir().ok().map(|d| d.join("bin").join(name))
}

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("config.json"))
}

fn read_config(app: &AppHandle) -> serde_json::Value {
    config_file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

/// User override: env YTDLP_PATH, then `ytdlp_path` in config.json.
fn configured_path(app: &AppHandle) -> Option<String> {
    std::env::var("YTDLP_PATH")
        .ok()
        .or_else(|| read_config(app).get("ytdlp_path")?.as_str().map(str::to_owned))
        .filter(|p| !p.trim().is_empty())
}

/// Configured path, else the managed standalone binary, else whatever is on PATH (often an outdated distro build).
fn resolve_bin(app: &AppHandle) -> String {
    configured_path(app)
        .or_else(|| managed_path(app).filter(|p| p.exists()).map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_else(|| DEFAULT_BIN.to_owned())
}

fn version_of(bin: &str) -> Option<String> {
    let out = command(bin).arg("--version").output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

// ---------- JS runtime (needed by current yt-dlp for YouTube challenges) ----------

fn on_path(bin: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) { format!("{bin}.exe") } else { bin.to_owned() };
    std::env::split_paths(&std::env::var_os("PATH")?).map(|d| d.join(&exe)).find(|p| p.is_file())
}

/// Highest-versioned node under ~/.nvm (GUI launches usually don't have nvm on PATH).
fn nvm_node(home: &Path) -> Option<PathBuf> {
    let mut versions: Vec<(Vec<u32>, PathBuf)> = std::fs::read_dir(home.join(".nvm/versions/node"))
        .ok()?
        .filter_map(|e| {
            let e = e.ok()?;
            let name = e.file_name().to_string_lossy().trim_start_matches('v').to_owned();
            let v = name.split('.').map(|p| p.parse().ok()).collect::<Option<Vec<u32>>>()?;
            let bin = e.path().join("bin/node");
            bin.is_file().then_some((v, bin))
        })
        .collect();
    versions.sort();
    versions.pop().map(|(_, p)| p)
}

/// Returns (runtime name, path), preferring deno (yt-dlp's default), then node, then bun.
pub fn find_js_runtime() -> Option<(&'static str, PathBuf)> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let in_home = |rel: &str| home.as_ref().map(|h| h.join(rel)).filter(|p| p.is_file());
    on_path("deno")
        .or_else(|| in_home(".deno/bin/deno"))
        .map(|p| ("deno", p))
        .or_else(|| on_path("node").or_else(|| home.as_deref().and_then(nvm_node)).map(|p| ("node", p)))
        .or_else(|| on_path("bun").or_else(|| in_home(".bun/bin/bun")).map(|p| ("bun", p)))
}

fn js_runtime_args(rt: &Option<(&'static str, PathBuf)>) -> Vec<String> {
    match rt {
        Some((name, path)) => vec!["--js-runtimes".into(), format!("{name}:{}", path.display())],
        None => vec![],
    }
}

// ---------- cookies ----------

/// Netscape cookies.txt (mirrors `netscapeCookies` in src/api/cookie.ts).
pub fn netscape_cookies(header: &str, now: u64) -> String {
    let expiry = now + 30 * 24 * 3600;
    let mut out = String::from("# Netscape HTTP Cookie File\n");
    for part in header.split(';') {
        let Some((name, value)) = part.split_once('=') else { continue };
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let secure = if name.starts_with("__Secure-") || name.starts_with("__Host-") { "TRUE" } else { "FALSE" };
        out.push_str(&format!(".youtube.com\tTRUE\t/\t{secure}\t{expiry}\t{name}\t{}\n", value.trim()));
    }
    out
}

/// Temporary 0600 cookie file, removed on drop (also on early return / panic).
struct TempCookies(PathBuf);

impl TempCookies {
    fn create(header: &str) -> Result<Self, String> {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
        let path = std::env::temp_dir().join(format!("ytdesk-cookies-{}-{nanos:x}.txt", std::process::id()));
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
        use std::io::Write;
        let mut f = opts.open(&path).map_err(|e| format!("cannot create cookie file: {e}"))?;
        f.write_all(netscape_cookies(header, now).as_bytes()).map_err(|e| e.to_string())?;
        Ok(Self(path))
    }
}

impl Drop for TempCookies {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

// ---------- commands ----------

#[tauri::command]
pub async fn ytdlp_stream_url(app: AppHandle, video_id: String, codecs: Vec<String>) -> Result<String, String> {
    if !valid_video_id(&video_id) {
        return Err("invalid video id".into());
    }
    let selector = format_selector(&codecs)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Config read and keyring (D-Bus) call block: keep them off the async runtime too.
        let bin = resolve_bin(&app);
        let cookie = crate::auth::auth_get_cookie().ok().flatten();
        let rt = find_js_runtime();
        let cookies = cookie.as_deref().map(TempCookies::create).transpose()?;
        let mut cmd = command(&bin);
        cmd.args(["-g", "-f", &selector, "--no-playlist", "--no-warnings", "--no-progress"]);
        cmd.args(js_runtime_args(&rt));
        if let Some(c) = &cookies {
            cmd.arg("--cookies").arg(&c.0);
        }
        cmd.arg("--").arg(format!("https://music.youtube.com/watch?v={video_id}"));
        let out = cmd
            .output()
            .map_err(|e| format!("cannot run '{bin}': {e}. Install yt-dlp from Settings or set its path."))?;
        drop(cookies);
        if !out.status.success() {
            let mut msg = format!("yt-dlp failed: {}", error_summary(&String::from_utf8_lossy(&out.stderr)));
            if rt.is_none() {
                msg.push_str("\nNo JavaScript runtime found: install deno (recommended) or node so yt-dlp can solve YouTube challenges.");
            }
            return Err(msg);
        }
        first_url(&String::from_utf8_lossy(&out.stdout)).ok_or_else(|| "yt-dlp returned no URL".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpStatus {
    path: String,
    version: Option<String>,
    managed: bool,
    configured: Option<String>,
    js_runtime: Option<String>,
}

#[tauri::command]
pub async fn ytdlp_status(app: AppHandle) -> Result<YtdlpStatus, String> {
    let path = resolve_bin(&app);
    let managed = managed_path(&app).is_some_and(|m| m.to_string_lossy() == path);
    let configured = configured_path(&app);
    tauri::async_runtime::spawn_blocking(move || YtdlpStatus {
        version: version_of(&path),
        path,
        managed,
        configured,
        js_runtime: find_js_runtime().map(|(n, p)| format!("{n} ({})", p.display())),
    })
    .await
    .map_err(|e| e.to_string())
}

/// Downloads the official standalone binary into <app data>/bin and returns its version.
#[tauri::command]
pub async fn ytdlp_install(app: AppHandle) -> Result<String, String> {
    let dest = managed_path(&app).ok_or("no app data dir")?;
    std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    let url = format!("{RELEASE_BASE}{}", asset_name());
    let res = tauri_plugin_http::reqwest::get(&url).await.map_err(|e| format!("download failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("download failed: HTTP {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| format!("download failed: {e}"))?;
    let tmp = dest.with_extension("part");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    let bin = dest.to_string_lossy().into_owned();
    tauri::async_runtime::spawn_blocking(move || version_of(&bin).ok_or_else(|| "installed binary does not run".to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Runs `yt-dlp -U` on the managed binary.
#[tauri::command]
pub async fn ytdlp_update(app: AppHandle) -> Result<String, String> {
    let bin = managed_path(&app).filter(|p| p.exists()).ok_or("managed yt-dlp is not installed")?;
    tauri::async_runtime::spawn_blocking(move || {
        let out = command(&bin).arg("-U").output().map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(if out.status.success() { &out.stdout } else { &out.stderr }).into_owned();
        let last = text.lines().last().unwrap_or("").to_owned();
        if out.status.success() { Ok(last) } else { Err(format!("yt-dlp -U failed: {last}")) }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sets (or clears with None/empty) the yt-dlp path override in config.json.
#[tauri::command]
pub fn ytdlp_set_path(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let file = config_file(&app).ok_or("no config dir")?;
    let mut cfg = read_config(&app);
    match path.filter(|p| !p.trim().is_empty()) {
        Some(p) => cfg["ytdlp_path"] = serde_json::Value::String(p),
        None => {
            if let Some(o) = cfg.as_object_mut() {
                o.remove("ytdlp_path");
            }
        }
    }
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(file, serde_json::to_string_pretty(&cfg).unwrap()).map_err(|e| e.to_string())
}

/// Startup: install the managed binary if missing (unless the user pinned a path), update it weekly.
pub fn ensure_fresh(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if configured_path(&app).is_some() {
            return;
        }
        let Some(path) = managed_path(&app) else { return };
        let stale = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .map(|t| t.elapsed().unwrap_or_default() > UPDATE_EVERY);
        let result = match stale {
            Err(_) => ytdlp_install(app.clone()).await,
            Ok(true) => {
                let r = ytdlp_update(app.clone()).await;
                // Touch so we don't retry on every launch when already up to date.
                let _ = std::fs::File::options().append(true).open(&path).and_then(|f| f.set_modified(SystemTime::now()));
                r
            }
            Ok(false) => return,
        };
        if let Err(e) = result {
            eprintln!("yt-dlp auto-install/update failed: {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_ids() {
        assert!(valid_video_id("dQw4w9WgXcQ"));
        assert!(!valid_video_id("--exec=rm"));
        assert!(!valid_video_id("abc"));
    }

    #[test]
    fn selectors() {
        assert_eq!(
            format_selector(&["opus".into(), "aac".into()]).unwrap(),
            "bestaudio[acodec=opus]/bestaudio[acodec^=mp4a]"
        );
        assert!(format_selector(&[]).is_err());
        assert!(format_selector(&["flac".into()]).is_err());
    }

    #[test]
    fn url_parsing() {
        assert_eq!(first_url("\nWARN x\nhttps://a/b?c=d\nhttps://z\n").as_deref(), Some("https://a/b?c=d"));
        assert_eq!(first_url("nothing"), None);
    }

    #[test]
    fn cookie_file_format() {
        let out = netscape_cookies("SID=a; __Secure-3PAPISID=b; bad", 100);
        let exp = 100 + 30 * 24 * 3600;
        assert_eq!(
            out,
            format!("# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tFALSE\t{exp}\tSID\ta\n.youtube.com\tTRUE\t/\tTRUE\t{exp}\t__Secure-3PAPISID\tb\n")
        );
    }

    #[test]
    fn temp_cookies_are_removed() {
        let p = {
            let t = TempCookies::create("SID=a").unwrap();
            assert!(t.0.exists());
            t.0.clone()
        };
        assert!(!p.exists());
    }

    #[test]
    fn error_summary_keeps_errors_and_tail() {
        let s = error_summary("[youtube] x\nERROR: [youtube] abc: Sign in to confirm\nline a\nline b\n");
        assert!(s.starts_with("ERROR: [youtube] abc: Sign in to confirm"));
        assert!(s.ends_with("line b"));
    }
}
