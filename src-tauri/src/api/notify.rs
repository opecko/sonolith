//! System notifications for consent requests. Clicking one shows Sonolith (also from the tray) and its consent screen.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Default, Clone)]
pub struct Notifications {
    /// Request id → notification id (Linux), so a resolved request's notification can be withdrawn.
    #[allow(dead_code)]
    ids: Arc<Mutex<HashMap<String, u32>>>,
}

fn open(app: &AppHandle, request_id: &str) {
    crate::tray::show_window(app);
    let _ = app.emit("api:consent-focus", serde_json::json!({ "requestId": request_id }));
}

#[cfg(target_os = "linux")]
mod imp {
    use super::*;
    use futures_util::StreamExt;
    use zbus::zvariant::Value;

    const DEST: &str = "org.freedesktop.Notifications";
    const PATH: &str = "/org/freedesktop/Notifications";

    async fn proxy(conn: &zbus::Connection) -> zbus::Result<zbus::Proxy<'static>> {
        zbus::Proxy::new(conn, DEST, PATH, DEST).await
    }

    impl Notifications {
        pub fn show(&self, app: &AppHandle, request_id: &str, title: &str, body: &str) {
            let (app, rid, title, body, ids) = (app.clone(), request_id.to_string(), title.to_string(), body.to_string(), self.ids.clone());
            tauri::async_runtime::spawn(async move {
                let _ = show(app, rid, title, body, ids).await;
            });
        }

        pub fn close(&self, request_id: &str) {
            let Some(id) = self.ids.lock().unwrap().remove(request_id) else { return };
            tauri::async_runtime::spawn(async move {
                if let Ok(conn) = zbus::Connection::session().await {
                    if let Ok(p) = proxy(&conn).await {
                        let _: zbus::Result<()> = p.call("CloseNotification", &(id,)).await;
                    }
                }
            });
        }
    }

    async fn show(app: AppHandle, rid: String, title: String, body: String, ids: Arc<Mutex<HashMap<String, u32>>>) -> zbus::Result<()> {
        let conn = zbus::Connection::session().await?;
        let p = proxy(&conn).await?;
        let mut invoked = p.receive_signal("ActionInvoked").await?;
        let mut closed = p.receive_signal("NotificationClosed").await?;
        let mut hints: HashMap<&str, Value> = HashMap::new();
        hints.insert("desktop-entry", Value::from("sonolith"));
        hints.insert("urgency", Value::U8(1));
        let actions = vec!["default", "Open Sonolith"];
        let id: u32 = p.call("Notify", &("Sonolith", 0u32, "sonolith", title.as_str(), body.as_str(), actions, hints, -1i32)).await?;
        ids.lock().unwrap().insert(rid.clone(), id);
        // Wait for a click or for the notification to go away (at most as long as the request lives).
        let deadline = tokio::time::sleep(std::time::Duration::from_secs(6 * 60));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                Some(msg) = invoked.next() => {
                    if let Ok((nid, _action)) = msg.body().deserialize::<(u32, String)>() {
                        if nid == id {
                            open(&app, &rid);
                            break;
                        }
                    }
                }
                Some(msg) = closed.next() => {
                    if msg.body().deserialize::<(u32, u32)>().is_ok_and(|(nid, _)| nid == id) {
                        break;
                    }
                }
                _ = &mut deadline => break,
                else => break,
            }
        }
        ids.lock().unwrap().remove(&rid);
        Ok(())
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::sync::Once;
    use tauri::Manager;
    use tauri_winrt_notification::Toast;

    /// Toasts need the app's AppUserModelID to be known to Windows, or Windows drops them without an error. The
    /// installer sets it on the Start menu shortcut, but only on a fresh install (an update through the updater
    /// creates no shortcut), so it is also registered here, under HKCU\Software\Classes\AppUserModelId, which works
    /// without a shortcut.
    fn register(app_id: &str) -> Result<(), String> {
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
        };
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let path = wide(&format!("Software\\Classes\\AppUserModelId\\{app_id}"));
        let mut key: HKEY = std::ptr::null_mut();
        // SAFETY: valid NUL-terminated strings and out-pointers; the key is closed below.
        let rc = unsafe {
            RegCreateKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, std::ptr::null(), REG_OPTION_NON_VOLATILE, KEY_SET_VALUE, std::ptr::null(), &mut key, std::ptr::null_mut())
        };
        if rc != 0 {
            return Err(format!("couldn't register for notifications (error {rc})"));
        }
        let name = wide("DisplayName");
        let value = wide("Sonolith");
        // SAFETY: `key` is open; the data is a NUL-terminated UTF-16 string and its size in bytes.
        let rc = unsafe { RegSetValueExW(key, name.as_ptr(), 0, REG_SZ, value.as_ptr().cast(), (value.len() * 2) as u32) };
        // SAFETY: opened above.
        unsafe { RegCloseKey(key) };
        if rc != 0 {
            return Err(format!("couldn't register for notifications (error {rc})"));
        }
        Ok(())
    }

    /// Notifications fail silently otherwise: a release build has no console, so the reason goes to the app's log.
    fn log(app: &AppHandle, line: &str) {
        use std::io::Write;
        let Ok(dir) = app.path().app_log_dir() else { return };
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("api.log")) {
            let _ = writeln!(f, "{} {line}", crate::api::server::now_ms());
        }
    }

    impl Notifications {
        pub fn show(&self, app: &AppHandle, request_id: &str, title: &str, body: &str) {
            static REGISTERED: Once = Once::new();
            let app_id = app.config().identifier.clone();
            REGISTERED.call_once(|| {
                if let Err(e) = register(&app_id) {
                    log(app, &e);
                }
            });
            let (handle, rid) = (app.clone(), request_id.to_string());
            let shown = Toast::new(&app_id)
                .title(title)
                .text1(body)
                .on_activated(move |_| {
                    open(&handle, &rid);
                    Ok(())
                })
                .show();
            if let Err(e) = shown {
                log(app, &format!("couldn't show a notification: {e}"));
            }
        }

        pub fn close(&self, _request_id: &str) {}
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
impl Notifications {
    pub fn show(&self, _app: &AppHandle, _request_id: &str, _title: &str, _body: &str) {}
    pub fn close(&self, _request_id: &str) {}
}
