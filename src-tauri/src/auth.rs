use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const SERVICE: &str = "ytdesk";
const ACCOUNT: &str = "ytmusic-cookie";
const LOGIN_LABEL: &str = "login";
const LOGIN_URL: &str =
    "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const YTM_URL: &str = "https://music.youtube.com/";
const CHROME_UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);

// Windows Credential Manager caps a blob at ~2.5 KB, so keep only cookies InnerTube auth needs.
const KEPT: &[&str] = &[
    "SID", "HSID", "SSID", "APISID", "SAPISID", "LOGIN_INFO", "PREF", "YSC", "VISITOR_INFO1_LIVE",
    "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PAPISID", "__Secure-3PAPISID",
    "__Secure-1PSIDTS", "__Secure-3PSIDTS", "__Secure-1PSIDCC", "__Secure-3PSIDCC", "SIDCC",
];

pub fn build_cookie_header<'a>(cookies: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    let mut seen: Vec<(&str, &str)> = Vec::new();
    for (name, value) in cookies {
        if !KEPT.contains(&name) {
            continue;
        }
        match seen.iter_mut().find(|(n, _)| *n == name) {
            Some(slot) => slot.1 = value,
            None => seen.push((name, value)),
        }
    }
    seen.iter().map(|(n, v)| format!("{n}={v}")).collect::<Vec<_>>().join("; ")
}

pub fn has_auth_cookie(header: &str) -> bool {
    header
        .split(';')
        .filter_map(|p| p.trim().split_once('='))
        .any(|(n, v)| n == "SAPISID" && !v.is_empty())
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn auth_get_cookie() -> Result<Option<String>, String> {
    // Stored as UTF-8 bytes (see auth_set_cookie); on Linux this matches entries written with set_password.
    match entry()?.get_secret().map(|b| String::from_utf8_lossy(&b).into_owned()) {
        Ok(c) if has_auth_cookie(&c) => return Ok(Some(c)),
        Ok(_) | Err(keyring::Error::NoEntry) => {}
        Err(e) => eprintln!("keyring read failed: {e}"),
    }
    Ok(std::env::var("YTM_COOKIE").ok().filter(|c| has_auth_cookie(c)))
}

#[tauri::command(async)]
pub fn auth_set_cookie(cookie: String) -> Result<(), String> {
    // set_password would store UTF-16 on Windows (2 bytes/char), and the ~1.6 KB cookie header would then exceed
    // the Credential Manager's 2560-byte blob limit. Raw UTF-8 fits on every platform.
    entry()?.set_secret(cookie.as_bytes()).map_err(|e| e.to_string())
}

/// Signs out: forgets the stored cookie and the Google/YouTube session cookies of the webview, so the next sign-in
/// actually asks for an account instead of silently reusing the old session. Other web storage (settings) is kept.
#[tauri::command]
pub async fn auth_clear(app: AppHandle) -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }
    // Cookie APIs deadlock on Windows when called from a sync command / the main thread.
    tauri::async_runtime::spawn_blocking(move || clear_session_cookies(&app))
        .await
        .map_err(|e| e.to_string())?
}

fn is_session_domain(domain: &str) -> bool {
    let d = domain.trim_start_matches('.');
    ["google.com", "youtube.com", "googleusercontent.com", "gstatic.com"]
        .iter()
        .any(|s| d == *s || d.ends_with(&format!(".{s}")))
        || d.starts_with("google.") // country domains (google.cz, …)
        || d.contains(".google.")
}

fn clear_session_cookies(app: &AppHandle) -> Result<(), String> {
    // All webviews share one cookie store, so the main window's view of it is enough.
    let Some(win) = app.get_webview_window("main") else { return Ok(()) };
    let cookies = win.cookies().map_err(|e| e.to_string())?;
    for c in cookies.into_iter().filter(|c| c.domain().is_some_and(is_session_domain)) {
        win.delete_cookie(c).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn auth_login(app: AppHandle) -> Result<String, String> {
    if let Some(old) = app.get_webview_window(LOGIN_LABEL) {
        let _ = old.close();
    }
    let url: Url = LOGIN_URL.parse().map_err(|e: url::ParseError| e.to_string())?;
    WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(url))
        .title("Sign in to YouTube Music")
        .inner_size(520.0, 720.0)
        .user_agent(CHROME_UA)
        // No browser context menu (Back, Reload, Inspect…) on Google's pages either.
        .initialization_script("window.addEventListener('contextmenu', (e) => e.preventDefault(), true);")
        .build()
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || wait_for_login(&app))
        .await
        .map_err(|e| e.to_string())?
}

fn wait_for_login(app: &AppHandle) -> Result<String, String> {
    let ytm: Url = YTM_URL.parse().map_err(|e: url::ParseError| e.to_string())?;
    let started = Instant::now();
    loop {
        std::thread::sleep(Duration::from_millis(800));
        let Some(win) = app.get_webview_window(LOGIN_LABEL) else {
            return Err("login cancelled".into());
        };
        if started.elapsed() > LOGIN_TIMEOUT {
            let _ = win.close();
            return Err("login timed out".into());
        }
        let on_ytm = win.url().map(|u| u.host_str() == ytm.host_str()).unwrap_or(false);
        if !on_ytm {
            continue;
        }
        let cookies = win.cookies_for_url(ytm.clone()).map_err(|e| e.to_string())?;
        let header = build_cookie_header(cookies.iter().map(|c| (c.name(), c.value())));
        if has_auth_cookie(&header) {
            auth_set_cookie(header.clone())?;
            let _ = win.close();
            return Ok(header);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_keeps_allowlisted_and_dedupes() {
        let h = build_cookie_header([("SID", "a"), ("junk", "x"), ("SAPISID", "b"), ("SID", "c")]);
        assert_eq!(h, "SID=c; SAPISID=b");
    }

    #[test]
    fn session_domains() {
        for d in [".google.com", "accounts.google.com", ".youtube.com", "music.youtube.com", "google.cz", ".google.cz"] {
            assert!(is_session_domain(d), "{d}");
        }
        for d in ["localhost", "example.com", "notgoogle.com", "youtube.com.evil.net"] {
            assert!(!is_session_domain(d), "{d}");
        }
    }

    #[test]
    fn detects_auth_cookie() {
        assert!(has_auth_cookie("SID=a; SAPISID=b"));
        assert!(!has_auth_cookie("SID=a; __Secure-3PAPISID=b"));
        assert!(!has_auth_cookie("SAPISID="));
    }
}
