//! System tray: playback controls + show/hide, so the window can be closed (nothing renders) while music plays.
//! Linux AppIndicator (tray-icon's backend in Tauri) only delivers menu events, never icon clicks, so "Show
//! Sonolith" is the menu's first item; on Windows a left click shows / focuses the window.
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

pub struct TrayItems<R: Runtime> {
    now: MenuItem<R>,
    play: MenuItem<R>,
    toggle: MenuItem<R>,
}

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window("main").or_else(|| app.webview_windows().into_values().next())
}

fn set_window_visible<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    let Some(w) = main_window(app) else { return };
    if visible {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    } else {
        let _ = w.hide();
    }
    if let Some(items) = app.try_state::<TrayItems<R>>() {
        let _ = items.toggle.set_text(if visible { "Hide Sonolith" } else { "Show Sonolith" });
    }
}

pub fn show_window<R: Runtime>(app: &AppHandle<R>) {
    set_window_visible(app, true);
}

pub fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
    let visible = main_window(app).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    set_window_visible(app, !visible);
}

/// Hides the window instead of quitting (used for the close button when "close to tray" is on).
pub fn hide_window<R: Runtime>(app: &AppHandle<R>) {
    set_window_visible(app, false);
}

/// The tray icon's id. With AppIndicator the SNI `Id` becomes "tray-icon tray app <this>" (tray-icon's fixed
/// prefix), so the id at least ends in the app's name; hosts show the `Title` set in `init`.
pub const TRAY_ID: &str = "sonolith";

pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let now = MenuItem::with_id(app, "now", "Nothing playing", false, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "Previous", true, None::<&str>)?;
    let play = MenuItem::with_id(app, "play", "Play", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Hide Sonolith", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    // Show / hide first: on Linux the menu is the only way back to the window.
    let menu = Menu::with_items(
        app,
        &[&toggle, &PredefinedMenuItem::separator(app)?, &now, &prev, &play, &next, &PredefinedMenuItem::separator(app)?, &quit],
    )?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Sonolith")
        .menu(&menu)
        // Windows: left click brings the window, right click opens the menu. (No effect with AppIndicator.)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, e| match e.id().as_ref() {
            id @ ("prev" | "play" | "next") => {
                let _ = app.emit("tray", id);
            }
            "toggle" => toggle_window(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let _tray = builder.build(app)?;
    #[cfg(target_os = "linux")]
    set_indicator_title(&_tray, "Sonolith");
    app.manage(TrayItems { now, play, toggle });
    Ok(())
}

/// SNI hosts (StatusNotifierWatcher clients like bars on Hyprland) label the item by its `Title`, falling back to its
/// `Id`. tray-icon never sets the AppIndicator title (its `set_title` sets the label drawn next to the icon, and
/// the tooltip is a no-op there), so hosts showed the Id "tray-icon tray app <id>". Set it through tray-icon's
/// documented escape hatch, on the main thread where the indicator lives.
#[cfg(target_os = "linux")]
fn set_indicator_title<R: Runtime>(tray: &tauri::tray::TrayIcon<R>, title: &'static str) {
    let _ = tray.with_inner_tray_icon(move |t| {
        // SAFETY: the pointer is valid while the tray icon is (it is, inside this call). libappindicator's wrapper
        // only holds the GObject pointer; set_title hands it to app_indicator_set_title and writes no Rust state,
        // and nothing else borrows the indicator during this main-thread call.
        unsafe {
            let indicator = t.app_indicator() as *mut libappindicator::AppIndicator;
            (*indicator).set_title(title);
        }
    });
}

/// Frontend → tray: current track line and Play/Pause label.
#[tauri::command]
pub fn tray_update(app: AppHandle, title: Option<String>, playing: bool) {
    let Some(items) = app.try_state::<TrayItems<tauri::Wry>>() else { return };
    let line = match title {
        Some(t) if t.chars().count() > 60 => format!("{}…", t.chars().take(59).collect::<String>()),
        Some(t) => t,
        None => "Nothing playing".into(),
    };
    let _ = items.now.set_text(line);
    let _ = items.play.set_text(if playing { "Pause" } else { "Play" });
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(if playing { "Sonolith: playing" } else { "Sonolith" }));
    }
}
