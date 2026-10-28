use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const SERVICE: &str = "sonolith";
/// The service ytdesk (this app's old name) stored the cookie under; read once to carry the sign-in over.
const OLD_SERVICE: &str = "ytdesk";
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

fn old_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(OLD_SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

/// Stored as UTF-8 bytes (see auth_set_cookie); on Linux this matches entries written with set_password.
fn read(entry: &keyring::Entry) -> Result<Option<String>, keyring::Error> {
    match entry.get_secret() {
        Ok(b) => Ok(Some(String::from_utf8_lossy(&b).into_owned()).filter(|c| has_auth_cookie(c))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

/// The ytdesk-era cookie, saved under the new service. The old entry stays (an older ytdesk still finds its
/// sign-in after a downgrade, and nothing is lost if the new write didn't stick); signing out deletes both.
fn migrate_old_cookie() -> Option<String> {
    // Startup asks for the cookie from several places at once: one of them moves it, the others find it moved.
    static MIGRATING: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = MIGRATING.lock().unwrap_or_else(|e| e.into_inner());
    if let Ok(Some(c)) = read(&entry().ok()?) {
        return Some(c);
    }
    let cookie = read(&old_entry().ok()?).ok()??;
    match entry().and_then(|e| e.set_secret(cookie.as_bytes()).map_err(|e| e.to_string())) {
        Ok(()) => eprintln!("keyring: moved the sign-in from \"{OLD_SERVICE}\" to \"{SERVICE}\""),
        Err(e) => eprintln!("keyring: couldn't save the sign-in under \"{SERVICE}\": {e}"),
    }
    Some(cookie)
}

/**
 * A copy of the sign-in next to the keyring's, for when the keyring can't be used: Linux without a Secret Service
 * (no gnome-keyring, KWallet or KeePassXC running), a KWallet that refuses the write, or one that's locked when
 * Sonolith starts (the read fails and the user would be signed out on every start). A file only the user can read
 * (0600), in the app's config dir, as browsers keep their cookies on such systems. Without it the sign-in failed with
 * a keyring error, the sign-in window stayed open on YouTube Music, and every later attempt opened already signed in.
 */
/// Linux keeps the copy with every sign-in (a locked KWallet at startup is the case it's for); Windows' Credential
/// Manager and the macOS Keychain don't get locked away like that, so there it's written only if they fail.
const ALWAYS_COPY: bool = cfg!(target_os = "linux");

fn fallback_path() -> Option<std::path::PathBuf> {
    let base = if cfg!(target_os = "windows") { dirs::data_dir() } else { dirs::config_dir() };
    base.map(|d| d.join(crate::IDENTIFIER).join("sign-in"))
}

fn read_fallback() -> Option<String> {
    let c = std::fs::read_to_string(fallback_path()?).ok()?;
    has_auth_cookie(c.trim()).then(|| c.trim().to_owned())
}

fn write_fallback(cookie: &str) -> Result<(), String> {
    let path = fallback_path().ok_or("no config directory")?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut opts, 0o600);
    let mut f = opts.open(&path).map_err(|e| e.to_string())?;
    // `mode` only applies to a new file: an existing one is set to user-only too.
    #[cfg(unix)]
    std::fs::set_permissions(&path, std::os::unix::fs::PermissionsExt::from_mode(0o600)).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut f, cookie.as_bytes()).map_err(|e| e.to_string())
}

/// The cookie is asked for from several places, each start and each yt-dlp call: a keyring problem is logged once.
fn log_once(line: String) {
    static LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if !LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
        crate::log_line(&line);
    }
}

#[tauri::command(async)]
pub fn auth_get_cookie() -> Result<Option<String>, String> {
    match entry().map(|e| read(&e)) {
        Ok(Ok(Some(c))) => {
            // Signed in before the copy existed: made now, so a keyring locked at a later start doesn't sign out.
            if ALWAYS_COPY && fallback_path().is_some_and(|p| !p.exists()) {
                let _ = write_fallback(&c);
            }
            return Ok(Some(c));
        }
        Ok(Ok(None)) => {
            if let Some(c) = migrate_old_cookie() {
                return Ok(Some(c));
            }
        }
        // A locked or missing keyring: the copy in the config dir (written with every sign-in) keeps the user signed in.
        Ok(Err(e)) => log_once(format!("sign-in: the system keyring can't be read ({e}); using the copy in the config dir")),
        Err(e) => log_once(format!("sign-in: no system keyring ({e}); using the copy in the config dir")),
    }
    Ok(read_fallback().or_else(|| std::env::var("YTM_COOKIE").ok().filter(|c| has_auth_cookie(c))))
}

#[tauri::command(async)]
pub fn auth_set_cookie(cookie: String) -> Result<(), String> {
    // set_password would store UTF-16 on Windows (2 bytes/char), and the ~1.6 KB cookie header would then exceed
    // the Credential Manager's 2560-byte blob limit. Raw UTF-8 fits on every platform.
    // The keyring, and the copy for when the keyring can't be used (see fallback_path, ALWAYS_COPY).
    let keyring = entry().and_then(|e| e.set_secret(cookie.as_bytes()).map_err(|e| e.to_string()));
    if keyring.is_ok() && !ALWAYS_COPY {
        // A copy from a time the keyring failed mustn't outlive this sign-in.
        if let Some(p) = fallback_path() {
            let _ = std::fs::remove_file(p);
        }
        return Ok(());
    }
    let file = write_fallback(&cookie);
    match (keyring, file) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(k), Ok(())) => {
            crate::log_line(&format!("sign-in: the system keyring can't store it ({k}); kept in the config dir"));
            Ok(())
        }
        (Ok(()), Err(f)) => {
            crate::log_line(&format!("sign-in: couldn't keep a copy in the config dir ({f}); it's in the keyring"));
            Ok(())
        }
        (Err(k), Err(f)) => {
            crate::log_line(&format!("sign-in: couldn't save it: keyring ({k}), config dir ({f})"));
            Err(format!("You're signed in, but Sonolith couldn't save it: the system keyring isn't available ({k}), and saving it in its config folder failed ({f})."))
        }
    }
}

/// Signs out: forgets the stored cookie and the Google/YouTube session cookies of the webview, so the next sign-in
/// actually asks for an account instead of silently reusing the old session. Other web storage (settings) is kept.
#[tauri::command]
pub async fn auth_clear(app: AppHandle) -> Result<(), String> {
    let fallback = fallback_path().is_some_and(|p| std::fs::remove_file(p).is_ok());
    for e in [entry(), old_entry()] {
        match e.map(|e| e.delete_credential()) {
            Ok(Ok(())) | Ok(Err(keyring::Error::NoEntry)) => {}
            // No keyring at all: fine when the sign-in lived in the fallback file (just removed).
            Ok(Err(e)) if !fallback => return Err(e.to_string()),
            Err(e) if !fallback => return Err(e),
            _ => {}
        }
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
    let mut noted = false;
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
        let cookies = match win.cookies_for_url(ytm.clone()) {
            Ok(c) => c,
            Err(e) => {
                crate::log_line(&format!("sign-in: couldn't read the sign-in window's cookies: {e}"));
                let _ = win.close();
                return Err(format!("Sonolith couldn't read the sign-in from its window ({e})."));
            }
        };
        let header = build_cookie_header(cookies.iter().map(|c| (c.name(), c.value())));
        // Diagnostics: on YouTube Music for a while without the cookie that means "signed in".
        if !noted && started.elapsed() > Duration::from_secs(30) {
            noted = true;
            let names: Vec<&str> = cookies.iter().map(|c| c.name()).collect();
            crate::log_line(&format!("sign-in: on YouTube Music without SAPISID after 30 s; cookies: {}", names.join(",")));
        }
        if has_auth_cookie(&header) {
            // Closed either way: left open on YouTube Music, the window only looked like it was still signing in.
            let _ = win.close();
            auth_set_cookie(header.clone())?;
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
