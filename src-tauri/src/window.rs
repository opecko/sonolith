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
    /// The startup color the webview was given (cleared again by `startup_done`).
    #[cfg(target_os = "linux")]
    splash: Option<[f64; 4]>,
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
        // The startup screen's background from the last run, for the moments before the page has loaded.
        let splash = if transparent { splash_rgba(&render::value(app, SPLASH_KEY)) } else { None };
        if transparent {
            // index.html reads it before any stylesheet loads (the startup screen, data-glass on <html>).
            builder = builder.initialization_script("window.__sonolithGlass = true;");
            // Mapped before the page has loaded, a transparent window would show nothing at all for a moment. With
            // a saved startup color the webview paints that until index.html takes over (`window_show`); without
            // one the window stays hidden until then. Either way the page's load is the fallback.
            builder = builder.visible(splash.is_some()).on_page_load(|w, p| {
                if p.event() == tauri::webview::PageLoadEvent::Finished {
                    startup_done(&w);
                }
            });
        }
        WindowState { transparent, composited, splash }
    };
    #[cfg(not(target_os = "linux"))]
    let state = WindowState { transparent: false, composited: None };
    let window = builder.build()?;
    #[cfg(target_os = "linux")]
    if let Some(rgba) = state.splash {
        set_webview_background(&window, rgba);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = window;
    app.manage(state);
    Ok(())
}

/// config.json key: the startup screen's background and surface opacity, `{ "bg": "#rrggbb", "opacity": 0.85 }`.
const SPLASH_KEY: &str = "splash";

/// The saved startup color as RGBA (0–1); None when missing or malformed.
fn splash_rgba(v: &serde_json::Value) -> Option<[f64; 4]> {
    let hex = v.get("bg")?.as_str()?.strip_prefix('#')?;
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let ch = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok().map(|n| n as f64 / 255.0);
    let opacity = v.get("opacity")?.as_f64().filter(|o| (0.3..=1.0).contains(o))?;
    Some([ch(0)?, ch(2)?, ch(4)?, opacity])
}

/// The WebKit view's own background (painted before any page). tao's window background for transparent windows
/// can't be used: it passes 0–255 channels to cairo unscaled, so every color comes out white.
#[cfg(target_os = "linux")]
fn set_webview_background<R: tauri::Runtime>(w: &tauri::WebviewWindow<R>, [red, green, blue, alpha]: [f64; 4]) {
    #[repr(C)]
    struct GdkRgba {
        red: f64,
        green: f64,
        blue: f64,
        alpha: f64,
    }
    extern "C" {
        fn webkit_web_view_set_background_color(view: *mut std::ffi::c_void, rgba: *const GdkRgba);
    }
    let _ = w.with_webview(move |wv| {
        use webkit2gtk::glib::object::ObjectType;
        let rgba = GdkRgba { red, green, blue, alpha };
        // SAFETY: a live WebKitWebView on the main thread (with_webview); WebKit copies the color.
        unsafe { webkit_web_view_set_background_color(wv.inner().as_ptr() as *mut _, &rgba) };
    });
}

/// The startup screen is in place (or the page has loaded): the window shows if it was hidden, and the webview's
/// startup color goes, or it would sit under the app's translucent surfaces.
fn startup_done<R: tauri::Runtime>(w: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "linux")]
    if w.try_state::<WindowState>().is_some_and(|s| s.splash.is_some()) {
        set_webview_background(w, [0.0; 4]);
    }
    if !w.is_visible().unwrap_or(true) {
        let _ = w.show();
    }
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
        startup_done(&w);
    }
}

/// Saves the startup screen's background for the next start's first moments (see `create_main`).
#[tauri::command(async)]
pub fn window_set_splash(app: AppHandle, bg: String, opacity: f64) -> Result<(), String> {
    let v = serde_json::json!({ "bg": bg, "opacity": opacity });
    if splash_rgba(&v).is_none() {
        return Err("Not a startup color.".into());
    }
    if render::value(&app, SPLASH_KEY) != v {
        render::write_value(&app, SPLASH_KEY, v)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::splash_rgba;
    use serde_json::json;

    #[test]
    fn startup_color_is_read_only_when_well_formed() {
        assert_eq!(splash_rgba(&json!({ "bg": "#ff0080", "opacity": 0.85 })), Some([1.0, 0.0, 128.0 / 255.0, 0.85]));
        assert_eq!(splash_rgba(&json!({ "bg": "red", "opacity": 0.85 })), None);
        assert_eq!(splash_rgba(&json!({ "bg": "#ff0080", "opacity": 2.0 })), None);
        assert_eq!(splash_rgba(&json!({ "bg": "#ff0080" })), None);
        assert_eq!(splash_rgba(&json!(null)), None);
    }
}

/// "Restart Sonolith" after changing a setting that only applies at startup.
#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.restart();
}
