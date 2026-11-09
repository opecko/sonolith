//! The main window, created here instead of from tauri.conf.json (`"create": false`) so it can be transparent.
//! "Transparent window" (Linux only, persisted in config.json): tao gives the GTK window an RGBA visual and the
//! webview a transparent background, which only works when the window is created, so changing it needs a restart.
//! Blur is the compositor's job; the app only draws translucent surfaces (see src/theme/glass.ts).
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindowBuilder};

use crate::render;

const KEY: &str = "transparent_window";

/// What the window was created with, decided once at startup.
pub struct WindowState {
    transparent: bool,
    composited: Option<bool>,
}

/// Whether the screen has a compositor: without one an RGBA window shows black where it's transparent (an X11
/// session with no compositing manager). Wayland always composites. None where it can't be asked.
#[cfg(target_os = "linux")]
fn composited() -> Option<bool> {
    // GDK is already linked through GTK; no binding crate needed for these two calls. Main thread only (setup).
    extern "C" {
        fn gdk_screen_get_default() -> *mut std::ffi::c_void;
        fn gdk_screen_is_composited(screen: *mut std::ffi::c_void) -> i32;
    }
    // SAFETY: GTK is initialised before setup runs, and setup runs on the GTK main thread.
    unsafe {
        let screen = gdk_screen_get_default();
        if screen.is_null() { None } else { Some(gdk_screen_is_composited(screen) != 0) }
    }
}

/// Creates the main window from its tauri.conf.json entry. Linux: transparent when the setting is on and the
/// screen composites (otherwise it would be black, so it stays opaque and Settings says why).
pub fn create_main(app: &AppHandle) -> tauri::Result<()> {
    let config = app.config().app.windows.iter().find(|w| w.label == "main").cloned().unwrap_or_default();
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::from_config(app, &config)?;
    #[cfg(target_os = "linux")]
    let state = {
        let composited = composited();
        let transparent = render::flag(app, KEY, false) && composited != Some(false);
        builder = builder.transparent(transparent);
        if transparent {
            // index.html reads it before any stylesheet loads (the startup screen, data-glass on <html>).
            builder = builder.initialization_script("window.__sonolithGlass = true;");
            // Mapped before the page has loaded, a transparent window shows nothing at all for a moment. It stays
            // hidden until index.html has its startup screen (`window_show`), or at the latest once the page loaded.
            builder = builder.visible(false).on_page_load(|w, p| {
                if p.event() == tauri::webview::PageLoadEvent::Finished {
                    let _ = w.show();
                }
            });
        }
        WindowState { transparent, composited }
    };
    #[cfg(not(target_os = "linux"))]
    let state = WindowState { transparent: false, composited: None };
    builder.build()?;
    app.manage(state);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    /// Transparency can be offered at all (Linux).
    supported: bool,
    /// The window was created transparent.
    transparent: bool,
    /// The stored setting, used at the next start.
    transparent_next: bool,
    /// See `composited()`.
    composited: Option<bool>,
    /// $XDG_SESSION_TYPE, $XDG_CURRENT_DESKTOP and whether $HYPRLAND_INSTANCE_SIGNATURE is set: Settings picks its
    /// blur hint from them.
    session_type: String,
    desktop: String,
    hyprland: bool,
}

#[tauri::command]
pub fn window_info(app: AppHandle, state: tauri::State<'_, WindowState>) -> WindowInfo {
    let env = |k: &str| std::env::var(k).unwrap_or_default();
    WindowInfo {
        supported: cfg!(target_os = "linux"),
        transparent: state.transparent,
        transparent_next: cfg!(target_os = "linux") && render::flag(&app, KEY, false),
        composited: state.composited,
        session_type: env("XDG_SESSION_TYPE"),
        desktop: env("XDG_CURRENT_DESKTOP"),
        hyprland: std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some(),
    }
}

#[tauri::command(async)]
pub fn window_set_transparent(app: AppHandle, enabled: bool) -> Result<(), String> {
    if !cfg!(target_os = "linux") {
        return Err("Transparent windows are only available on Linux.".into());
    }
    render::write_flag(&app, KEY, enabled)
}

/// index.html: the startup screen is in place, a hidden (transparent) main window may show now.
#[tauri::command]
pub fn window_show(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if !w.is_visible().unwrap_or(true) {
            let _ = w.show();
        }
    }
}

/// "Restart Sonolith" after changing a setting that only applies at startup.
#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.restart();
}
