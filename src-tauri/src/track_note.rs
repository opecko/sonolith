//! "Notify when the song changes" (Settings → Playback, off by default): one system notification per new track,
//! which replaces the previous one (Linux) instead of piling up. Clicking it shows Sonolith. The cover is downloaded
//! here, only from YouTube's image hosts, into the cache directory; the frontend never picks what Rust downloads
//! beyond a thumbnail URL on those hosts.
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;

/// Image hosts a thumbnail may come from (YouTube Music covers, video stills, channel avatars).
const COVER_HOSTS: [&str; 3] = ["ytimg.com", "googleusercontent.com", "ggpht.com"];
/// A cover is a few dozen kB; anything bigger isn't one.
const COVER_MAX: usize = 2 << 20;

/// An https URL on one of COVER_HOSTS (the host itself or a subdomain).
fn cover_allowed(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https" &&
            u.host_str().is_some_and(|h| COVER_HOSTS.iter().any(|d| h == *d || h.ends_with(&format!(".{d}"))))
    })
}

/// Downloads the cover to the cache dir (one file, overwritten each time). None on any failure: the notification
/// goes out without it.
async fn fetch_cover(app: &AppHandle, url: &str) -> Option<std::path::PathBuf> {
    if !cover_allowed(url) {
        return None;
    }
    let res = reqwest::Client::new().get(url).timeout(std::time::Duration::from_secs(5)).send().await.ok()?;
    if !res.status().is_success() || res.content_length().is_some_and(|n| n as usize > COVER_MAX) {
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    if bytes.len() > COVER_MAX {
        return None;
    }
    let path = app.path().app_cache_dir().ok()?.join("notification-cover");
    std::fs::create_dir_all(path.parent()?).ok()?;
    std::fs::write(&path, &bytes).ok()?;
    Some(path)
}

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use futures_util::StreamExt;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU32, Ordering};
    use zbus::zvariant::Value;

    /// The notification on screen now, replaced by the next one.
    static LAST: AtomicU32 = AtomicU32::new(0);

    pub async fn show(app: AppHandle, title: String, body: String, cover: Option<std::path::PathBuf>) -> zbus::Result<()> {
        let conn = zbus::Connection::session().await?;
        let dest = "org.freedesktop.Notifications";
        let p = zbus::Proxy::new(&conn, dest, "/org/freedesktop/Notifications", dest).await?;
        let mut invoked = p.receive_signal("ActionInvoked").await?;
        let mut hints: HashMap<&str, Value> = HashMap::new();
        hints.insert("desktop-entry", Value::from("sonolith"));
        hints.insert("urgency", Value::U8(0));
        // Transient: it doesn't stay in the notification history, a song change is old news soon.
        hints.insert("transient", Value::Bool(true));
        let image = cover.map(|c| format!("file://{}", c.display()));
        if let Some(i) = &image {
            hints.insert("image-path", Value::from(i.as_str()));
        }
        let actions = vec!["default", "Show Sonolith"];
        let replaces = LAST.load(Ordering::Relaxed);
        let id: u32 = p.call("Notify", &("Sonolith", replaces, "sonolith", title.as_str(), body.as_str(), actions, hints, 5000i32)).await?;
        LAST.store(id, Ordering::Relaxed);
        // A click shows the window; stop listening once a newer notification took this one's place.
        let deadline = tokio::time::sleep(std::time::Duration::from_secs(60));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                Some(msg) = invoked.next() => {
                    if msg.body().deserialize::<(u32, String)>().is_ok_and(|(nid, _)| nid == id) {
                        crate::tray::show_window(&app);
                        break;
                    }
                }
                _ = &mut deadline => break,
                else => break,
            }
            if LAST.load(Ordering::Relaxed) != id {
                break;
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use tauri_winrt_notification::{Duration, Toast};

    pub async fn show(app: AppHandle, title: String, body: String, cover: Option<std::path::PathBuf>) -> Result<(), String> {
        let handle = app.clone();
        let mut toast = Toast::new(&app.config().identifier).title(&title).text1(&body).duration(Duration::Short).sound(None);
        if let Some(c) = &cover {
            toast = toast.image(c, "");
        }
        toast
            .on_activated(move |_| {
                crate::tray::show_window(&handle);
                Ok(())
            })
            .show()
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod imp {
    use super::*;
    pub async fn show(_app: AppHandle, _title: String, _body: String, _cover: Option<std::path::PathBuf>) -> Result<(), String> {
        Ok(())
    }
}

/// A notification for the song that just started: title, "Artist • Album", the cover if it can be had.
#[tauri::command(async)]
pub async fn track_notify(app: AppHandle, title: String, body: String, thumbnail: Option<String>) -> Result<(), String> {
    let clip = |s: &str, n: usize| s.chars().take(n).collect::<String>();
    let cover = match thumbnail {
        Some(url) => fetch_cover(&app, &url).await,
        None => None,
    };
    imp::show(app, clip(&title, 200), clip(&body, 300), cover).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::cover_allowed;

    #[test]
    fn covers_come_only_from_youtube_image_hosts_over_https() {
        assert!(cover_allowed("https://i.ytimg.com/vi/abc/hqdefault.jpg"));
        assert!(cover_allowed("https://lh3.googleusercontent.com/x=w544-h544"));
        assert!(cover_allowed("https://yt3.ggpht.com/a/b"));
        assert!(!cover_allowed("http://i.ytimg.com/vi/abc/hqdefault.jpg"));
        assert!(!cover_allowed("https://evil.com/?h=.ytimg.com"));
        assert!(!cover_allowed("https://ytimg.com.evil.com/a.jpg"));
        assert!(!cover_allowed("file:///etc/passwd"));
        assert!(!cover_allowed("not a url"));
    }
}
