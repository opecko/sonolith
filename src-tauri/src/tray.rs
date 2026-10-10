//! System tray: playback controls + show/hide, so the window can be closed (nothing renders) while music plays.
//! Linux AppIndicator only delivers menu events (no icon clicks), so everything lives in the menu.
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
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
        let _ = items.toggle.set_text(if visible { "Hide ytdesk" } else { "Show ytdesk" });
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

pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let now = MenuItem::with_id(app, "now", "Nothing playing", false, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "Previous", true, None::<&str>)?;
    let play = MenuItem::with_id(app, "play", "Play", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", "Hide ytdesk", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&now, &PredefinedMenuItem::separator(app)?, &prev, &play, &next, &PredefinedMenuItem::separator(app)?, &toggle, &quit],
    )?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("ytdesk")
        .menu(&menu)
        .show_menu_on_left_click(true)
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
    builder.build(app)?;
    app.manage(TrayItems { now, play, toggle });
    Ok(())
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
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(if playing { "ytdesk: playing" } else { "ytdesk" }));
    }
}
