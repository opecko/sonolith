//! "Keep the screen on while playing" (Settings → Playback): while music plays, the screen doesn't dim, lock or
//! go to sleep, and neither does the computer. Linux asks the desktop through D-Bus (org.freedesktop.ScreenSaver,
//! which KDE, GNOME, Xfce and idle daemons such as hypridle honor; the XDG desktop portal as the fallback); Windows
//! sets the thread execution state. The frontend decides when (src/stores/keepAwake.ts).
/// One inhibitor; an async lock, so a call that is still talking to D-Bus finishes before the next one looks.
pub struct AwakeState(tokio::sync::Mutex<imp::Inhibitor>);

impl AwakeState {
    pub fn new() -> AwakeState {
        AwakeState(tokio::sync::Mutex::new(imp::Inhibitor::default()))
    }
}

#[tauri::command]
pub async fn awake_set(state: tauri::State<'_, AwakeState>, on: bool) -> Result<(), String> {
    let mut inhibitor = state.0.lock().await;
    if on { inhibitor.inhibit().await } else { inhibitor.release().await }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::collections::HashMap;
    use zbus::zvariant::{OwnedObjectPath, Value};

    const REASON: &str = "Playing music";

    /// The live inhibition. Desktops end an inhibition when its D-Bus connection closes, so it is kept open.
    #[derive(Default)]
    pub enum Inhibitor {
        #[default]
        Off,
        ScreenSaver { conn: zbus::Connection, cookie: u32 },
        Portal { conn: zbus::Connection, request: OwnedObjectPath },
    }

    impl Inhibitor {
        pub async fn inhibit(&mut self) -> Result<(), String> {
            if !matches!(self, Inhibitor::Off) {
                return Ok(());
            }
            let conn = zbus::Connection::session().await.map_err(|e| e.to_string())?;
            for path in ["/org/freedesktop/ScreenSaver", "/ScreenSaver"] {
                let Ok(p) = zbus::Proxy::new(&conn, "org.freedesktop.ScreenSaver", path, "org.freedesktop.ScreenSaver").await else { continue };
                if let Ok(cookie) = p.call::<_, _, u32>("Inhibit", &("Sonolith", REASON)).await {
                    *self = Inhibitor::ScreenSaver { conn, cookie };
                    return Ok(());
                }
            }
            // No screensaver service (some Wayland desktops): the portal, flag 8 = idle.
            let p = zbus::Proxy::new(&conn, "org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop", "org.freedesktop.portal.Inhibit")
                .await
                .map_err(|e| e.to_string())?;
            let mut options: HashMap<&str, Value> = HashMap::new();
            options.insert("reason", Value::from(REASON));
            let request: OwnedObjectPath = p.call("Inhibit", &("", 8u32, options)).await.map_err(|e| e.to_string())?;
            *self = Inhibitor::Portal { conn, request };
            Ok(())
        }

        pub async fn release(&mut self) -> Result<(), String> {
            match std::mem::take(self) {
                Inhibitor::Off => Ok(()),
                Inhibitor::ScreenSaver { conn, cookie } => {
                    for path in ["/org/freedesktop/ScreenSaver", "/ScreenSaver"] {
                        if let Ok(p) = zbus::Proxy::new(&conn, "org.freedesktop.ScreenSaver", path, "org.freedesktop.ScreenSaver").await {
                            if p.call::<_, _, ()>("UnInhibit", &(cookie,)).await.is_ok() {
                                return Ok(());
                            }
                        }
                    }
                    // Dropping the connection ends it anyway.
                    Ok(())
                }
                Inhibitor::Portal { conn, request } => {
                    if let Ok(p) = zbus::Proxy::new(&conn, "org.freedesktop.portal.Desktop", request, "org.freedesktop.portal.Request").await {
                        let _: zbus::Result<()> = p.call("Close", &()).await;
                    }
                    Ok(())
                }
            }
        }
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::mpsc;
    use std::sync::OnceLock;
    use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED};

    /// The execution state belongs to the thread that sets it, so one thread that lives as long as the app holds it.
    fn worker() -> &'static mpsc::Sender<bool> {
        static TX: OnceLock<mpsc::Sender<bool>> = OnceLock::new();
        TX.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<bool>();
            std::thread::spawn(move || {
                for on in rx {
                    let flags = if on { ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED } else { ES_CONTINUOUS };
                    // SAFETY: plain flags; no pointers.
                    unsafe { SetThreadExecutionState(flags) };
                }
            });
            tx
        })
    }

    #[derive(Default)]
    pub struct Inhibitor;

    impl Inhibitor {
        pub async fn inhibit(&mut self) -> Result<(), String> {
            worker().send(true).map_err(|e| e.to_string())
        }
        pub async fn release(&mut self) -> Result<(), String> {
            worker().send(false).map_err(|e| e.to_string())
        }
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
mod imp {
    #[derive(Default)]
    pub struct Inhibitor;
    impl Inhibitor {
        pub async fn inhibit(&mut self) -> Result<(), String> {
            Ok(())
        }
        pub async fn release(&mut self) -> Result<(), String> {
            Ok(())
        }
    }
}
