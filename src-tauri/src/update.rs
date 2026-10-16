//! Update check against the GitHub releases of this repo, and (Windows) downloading and starting the NSIS installer.
//! Every URL is built here from REPO or checked against it, so the frontend can't point a download anywhere else.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_http::reqwest;
use tauri_plugin_opener::OpenerExt;

const REPO: &str = "opecko/ytdesk";

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GhAsset>,
    #[serde(default)]
    published_at: Option<String>,
}

#[derive(Serialize)]
pub struct UpdateInfo {
    current: String,
    latest: String,
    newer: bool,
    notes: String,
    url: String,
    /// A Windows installer is attached and this build can run it.
    installer: bool,
    /// Installed from the AUR: update with the AUR helper instead of downloading from GitHub.
    aur: Option<AurInstall>,
}

#[derive(Serialize)]
pub struct AurInstall {
    /// "ytdesk" (built from source) or "ytdesk-bin".
    package: String,
    /// AUR helpers found on PATH, in order of preference (may be empty).
    helpers: Vec<String>,
}

/// The AUR package that owns the running binary, if any (Arch-based distros only; dev builds aren't owned).
#[cfg(target_os = "linux")]
fn aur_install() -> Option<AurInstall> {
    let exe = std::env::current_exe().ok()?;
    let out = std::process::Command::new("pacman").arg("-Qqo").arg(&exe).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let package = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    if package != "ytdesk" && package != "ytdesk-bin" {
        return None;
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    let helpers = ["yay", "paru"]
        .into_iter()
        .filter(|h| std::env::split_paths(&path).any(|dir| dir.join(h).is_file()))
        .map(String::from)
        .collect();
    Some(AurInstall { package, helpers })
}

#[cfg(not(target_os = "linux"))]
fn aur_install() -> Option<AurInstall> {
    None
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// "v1.2.3" / "1.2.3" → [1, 2, 3]; anything after a '-' or '+' is ignored.
fn parse_version(v: &str) -> Option<Vec<u64>> {
    let core = v.trim().trim_start_matches('v').split(['-', '+']).next()?;
    core.split('.').map(|p| p.parse().ok()).collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

fn installer_name(version: &str) -> String {
    format!("ytdesk_{version}_x64-setup.exe")
}

fn client(app: &AppHandle) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("ytdesk/{}", app.package_info().version))
        .build()
        .map_err(|e| e.to_string())
}

async fn release(app: &AppHandle, which: &str) -> Result<GhRelease, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/{which}");
    let res = client(app)?
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("update check failed: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("update check failed: HTTP {}", res.status()));
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("unexpected GitHub response: {e}"))
}

#[derive(Serialize)]
pub struct ChangelogEntry {
    version: String,
    /// ISO 8601 publish time.
    date: String,
    notes: String,
}

/// Published releases, newest first, for the changelog in Settings → About.
#[tauri::command]
pub async fn update_changelog(app: AppHandle) -> Result<Vec<ChangelogEntry>, String> {
    let res = client(&app)?
        .get(format!("https://api.github.com/repos/{REPO}/releases?per_page=50"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("couldn't load the changelog: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("couldn't load the changelog: HTTP {}", res.status()));
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    let releases: Vec<GhRelease> = serde_json::from_str(&text).map_err(|e| format!("unexpected GitHub response: {e}"))?;
    Ok(releases
        .into_iter()
        .filter(|r| !r.draft && !r.prerelease)
        .map(|r| ChangelogEntry {
            version: r.tag_name.trim_start_matches('v').to_owned(),
            date: r.published_at.unwrap_or_default(),
            notes: r.body.unwrap_or_default(),
        })
        .collect())
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateInfo, String> {
    let rel = release(&app, "latest").await?;
    let current = app.package_info().version.to_string();
    let latest = rel.tag_name.trim_start_matches('v').to_owned();
    let installer = cfg!(windows) && rel.assets.iter().any(|a| a.name == installer_name(&latest));
    Ok(UpdateInfo {
        newer: !rel.draft && !rel.prerelease && is_newer(&latest, &current),
        current,
        latest,
        notes: rel.body.unwrap_or_default(),
        url: rel.html_url,
        installer,
        // pacman is a quick local query, but still keep it off the async runtime.
        aur: tauri::async_runtime::spawn_blocking(aur_install).await.ok().flatten(),
    })
}

/// Opens the latest release page in the default browser.
#[tauri::command]
pub fn update_open_page(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(format!("https://github.com/{REPO}/releases/latest"), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Opens a project page from Settings → About. Only these known links, never an arbitrary URL from the webview.
#[tauri::command]
pub fn open_credit(app: AppHandle, name: String) -> Result<(), String> {
    let url = match name.as_str() {
        "ytdesk" => format!("https://github.com/{REPO}"),
        _ => return Err(format!("unknown link {name}")),
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Hash for `name` from a `sha256sum` listing ("<hex>  <name>" or "<hex> *<name>").
fn expected_sha256(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, file) = line.split_once(char::is_whitespace)?;
        (file.trim().trim_start_matches('*') == name && hash.len() == 64).then(|| hash.to_ascii_lowercase())
    })
}

/// Downloads the installer of `version` from its GitHub release, checks it against the release's SHA256SUMS,
/// starts it and quits ytdesk so the installer can replace the files. Progress: "update-progress" events.
#[tauri::command]
pub async fn update_install(app: AppHandle, version: String) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("installing updates is only supported on Windows".into());
    }
    parse_version(&version).ok_or("invalid version")?;
    let rel = release(&app, &format!("tags/v{version}")).await?;
    let name = installer_name(&version);
    let prefix = format!("https://github.com/{REPO}/releases/download/");
    let asset_url = |wanted: &str| {
        rel.assets
            .iter()
            .find(|a| a.name == wanted)
            .map(|a| a.browser_download_url.clone())
            .filter(|u| u.starts_with(&prefix))
            .ok_or_else(|| format!("{wanted} is missing from the release"))
    };
    let exe_url = asset_url(&name)?;
    let sums_url = asset_url("SHA256SUMS")?;
    let http = client(&app)?;

    let sums = http.get(&sums_url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("download failed: {e}"))?;
    let sums = sums.text().await.map_err(|e| format!("download failed: {e}"))?;
    let expected = expected_sha256(&sums, &name).ok_or("the installer is not listed in SHA256SUMS")?;

    let mut res = http.get(&exe_url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("download failed: {e}"))?;
    let total = res.content_length();
    let mut data = Vec::with_capacity(total.unwrap_or(0) as usize);
    let mut last_emit = 0u64;
    while let Some(chunk) = res.chunk().await.map_err(|e| format!("download failed: {e}"))? {
        data.extend_from_slice(&chunk);
        let downloaded = data.len() as u64;
        if downloaded - last_emit >= 256 * 1024 || Some(downloaded) == total {
            last_emit = downloaded;
            let _ = app.emit("update-progress", Progress { downloaded, total });
        }
    }

    use sha2::{Digest, Sha256};
    let actual: String = Sha256::digest(&data).iter().map(|b| format!("{b:02x}")).collect();
    if actual != expected {
        return Err("the downloaded installer is corrupted (checksum mismatch); try again".into());
    }

    let dir = std::env::temp_dir().join("ytdesk-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    std::fs::write(&path, &data).map_err(|e| format!("cannot save the installer: {e}"))?;
    std::process::Command::new(&path).spawn().map_err(|e| format!("cannot start the installer: {e}"))?;

    // Give the installer a moment to show its window, then quit so it can replace ytdesk.exe.
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        handle.exit(0);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert!(is_newer("v1.2.0", "1.1.9"));
        assert!(is_newer("1.10.0", "1.9.0"));
        assert!(!is_newer("v1.1.2", "1.1.2"));
        assert!(!is_newer("1.1.1", "1.1.2"));
        assert!(!is_newer("garbage", "1.0.0"));
        // Major bumps compare as numbers, not text.
        assert!(is_newer("2.0.0", "1.3.0"));
        assert!(is_newer("v2.0.0", "1.99.99"));
        assert!(!is_newer("1.3.0", "2.0.0"));
        assert!(is_newer("10.0.0", "9.9.9"));
    }

    #[test]
    fn sums() {
        let s = "aa  other.deb\n0123456789abcdef0123456789abcdef0123456789abcdef0123456789ABCDEF  ytdesk_1.2.0_x64-setup.exe\n";
        assert_eq!(expected_sha256(s, "ytdesk_1.2.0_x64-setup.exe").unwrap(), "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
        assert!(expected_sha256(s, "missing.exe").is_none());
    }
}
