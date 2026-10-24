//! MPRIS2 (org.mpris.MediaPlayer2) for desktop media widgets, playerctl and KDE/GNOME media controls.
//! The webview's own Media Session only covers a fraction of the spec, so on Linux the player is exported here with
//! the full interface: Raise/Quit, seeking (Seek, SetPosition, Seeked), volume, loop, shuffle and metadata.
//! The frontend pushes snapshots (`mpris_update`); controls coming from D-Bus are re-emitted as the `mpris` event.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use zbus::object_server::SignalEmitter;
use zbus::zvariant::{ObjectPath, Value};
use zbus::{fdo, interface, Connection};

const PATH: &str = "/org/mpris/MediaPlayer2";
const NO_TRACK: &str = "/org/mpris/MediaPlayer2/TrackList/NoTrack";
const PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    id: String,
    title: String,
    artists: Vec<String>,
    album: Option<String>,
    art: Option<String>,
    length_us: Option<i64>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// "Playing" | "Paused" | "Stopped"
    status: String,
    track: Option<TrackInfo>,
    position_us: i64,
    volume: f64,
    shuffle: bool,
    /// "None" | "Playlist" | "Track"
    loop_status: String,
    can_next: bool,
    can_prev: bool,
    can_seek: bool,
}

struct Inner {
    snap: Snapshot,
    /// Position at `anchor`; while playing the live position is extrapolated from it.
    anchor: Instant,
}

impl Inner {
    fn position_us(&self) -> i64 {
        let base = self.snap.position_us;
        let live = if self.snap.status == "Playing" { base + self.anchor.elapsed().as_micros() as i64 } else { base };
        match self.snap.track.as_ref().and_then(|t| t.length_us) {
            Some(len) => live.clamp(0, len),
            None => live.max(0),
        }
    }
}

pub struct Shared {
    app: AppHandle,
    inner: Mutex<Inner>,
    conn: OnceLock<Connection>,
}

fn blank() -> Snapshot {
    Snapshot {
        status: "Stopped".into(),
        track: None,
        position_us: 0,
        volume: 1.0,
        shuffle: false,
        loop_status: "None".into(),
        can_next: false,
        can_prev: false,
        can_seek: false,
    }
}

fn send(app: &AppHandle, action: &str, value: serde_json::Value) {
    let _ = app.emit("mpris", json!({ "action": action, "value": value }));
}

fn track_path(id: &str) -> String {
    let clean: String = id.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    format!("/org/sonolith/track/{clean}")
}

fn metadata(track: Option<&TrackInfo>) -> HashMap<String, Value<'static>> {
    let mut m: HashMap<String, Value<'static>> = HashMap::new();
    let Some(t) = track else {
        m.insert("mpris:trackid".into(), Value::from(ObjectPath::try_from(NO_TRACK).unwrap()));
        return m;
    };
    let path = ObjectPath::try_from(track_path(&t.id)).unwrap_or_else(|_| ObjectPath::try_from(NO_TRACK).unwrap());
    m.insert("mpris:trackid".into(), Value::from(path));
    m.insert("xesam:title".into(), Value::from(t.title.clone()));
    m.insert("xesam:artist".into(), Value::from(t.artists.clone()));
    if let Some(a) = t.album.as_ref().filter(|a| !a.is_empty()) {
        m.insert("xesam:album".into(), Value::from(a.clone()));
    }
    if let Some(l) = t.length_us.filter(|l| *l > 0) {
        m.insert("mpris:length".into(), Value::from(l));
    }
    if let Some(a) = t.art.as_ref().filter(|a| !a.is_empty()) {
        m.insert("mpris:artUrl".into(), Value::from(a.clone()));
    }
    m.insert("xesam:url".into(), Value::from(format!("https://music.youtube.com/watch?v={}", t.id)));
    m
}

struct Root(AppHandle);

#[interface(name = "org.mpris.MediaPlayer2")]
impl Root {
    fn raise(&self) {
        crate::tray::show_window(&self.0);
    }
    fn quit(&self) {
        self.0.exit(0);
    }
    #[zbus(property)]
    fn can_quit(&self) -> bool {
        true
    }
    #[zbus(property)]
    fn can_raise(&self) -> bool {
        true
    }
    #[zbus(property)]
    fn has_track_list(&self) -> bool {
        false
    }
    #[zbus(property)]
    fn identity(&self) -> &str {
        "Sonolith"
    }
    #[zbus(property)]
    fn desktop_entry(&self) -> &str {
        "sonolith"
    }
    #[zbus(property)]
    fn supported_uri_schemes(&self) -> Vec<String> {
        vec![]
    }
    #[zbus(property)]
    fn supported_mime_types(&self) -> Vec<String> {
        vec![]
    }
}

struct Player(&'static Shared);

impl Player {
    fn with<T>(&self, f: impl FnOnce(&Snapshot) -> T) -> T {
        f(&self.0.inner.lock().unwrap().snap)
    }
}

#[interface(name = "org.mpris.MediaPlayer2.Player")]
impl Player {
    fn next(&self) {
        send(&self.0.app, "next", json!(null));
    }
    fn previous(&self) {
        send(&self.0.app, "previous", json!(null));
    }
    fn pause(&self) {
        send(&self.0.app, "pause", json!(null));
    }
    fn play_pause(&self) {
        send(&self.0.app, "playpause", json!(null));
    }
    fn stop(&self) {
        send(&self.0.app, "stop", json!(null));
    }
    fn play(&self) {
        send(&self.0.app, "play", json!(null));
    }
    /// Relative seek in microseconds.
    fn seek(&self, offset: i64) {
        send(&self.0.app, "seek", json!(offset as f64 / 1e6));
    }
    fn set_position(&self, track_id: ObjectPath<'_>, position: i64) {
        let current = self.with(|s| s.track.as_ref().map(|t| track_path(&t.id)));
        if current.as_deref() == Some(track_id.as_str()) {
            send(&self.0.app, "setposition", json!(position as f64 / 1e6));
        }
    }
    fn open_uri(&self, _uri: &str) {}

    #[zbus(signal)]
    async fn seeked(emitter: &SignalEmitter<'_>, position: i64) -> zbus::Result<()>;

    #[zbus(property)]
    fn playback_status(&self) -> String {
        self.with(|s| s.status.clone())
    }
    #[zbus(property)]
    fn loop_status(&self) -> String {
        self.with(|s| s.loop_status.clone())
    }
    #[zbus(property)]
    fn set_loop_status(&self, v: String) {
        send(&self.0.app, "loop", json!(v));
    }
    #[zbus(property)]
    fn rate(&self) -> f64 {
        1.0
    }
    #[zbus(property)]
    fn set_rate(&self, _v: f64) {}
    #[zbus(property)]
    fn shuffle(&self) -> bool {
        self.with(|s| s.shuffle)
    }
    #[zbus(property)]
    fn set_shuffle(&self, v: bool) {
        send(&self.0.app, "shuffle", json!(v));
    }
    #[zbus(property)]
    fn metadata(&self) -> HashMap<String, Value<'static>> {
        self.with(|s| metadata(s.track.as_ref()))
    }
    #[zbus(property)]
    fn volume(&self) -> f64 {
        self.with(|s| s.volume)
    }
    #[zbus(property)]
    fn set_volume(&self, v: f64) {
        send(&self.0.app, "volume", json!(v.clamp(0.0, 1.0)));
    }
    #[zbus(property(emits_changed_signal = "false"))]
    fn position(&self) -> i64 {
        self.0.inner.lock().unwrap().position_us()
    }
    #[zbus(property)]
    fn minimum_rate(&self) -> f64 {
        1.0
    }
    #[zbus(property)]
    fn maximum_rate(&self) -> f64 {
        1.0
    }
    #[zbus(property)]
    fn can_go_next(&self) -> bool {
        self.with(|s| s.can_next)
    }
    #[zbus(property)]
    fn can_go_previous(&self) -> bool {
        self.with(|s| s.can_prev)
    }
    #[zbus(property)]
    fn can_play(&self) -> bool {
        self.with(|s| s.track.is_some())
    }
    #[zbus(property)]
    fn can_pause(&self) -> bool {
        self.with(|s| s.track.is_some())
    }
    #[zbus(property)]
    fn can_seek(&self) -> bool {
        self.with(|s| s.can_seek)
    }
    #[zbus(property)]
    fn can_control(&self) -> bool {
        true
    }
}

/// Registers the managed state right away (so early snapshots aren't lost) and exports the player in the background.
pub fn init(app: &AppHandle) {
    let shared: &'static Shared =
        Box::leak(Box::new(Shared { app: app.clone(), inner: Mutex::new(Inner { snap: blank(), anchor: Instant::now() }), conn: OnceLock::new() }));
    app.manage(MprisState(shared));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let built = async {
            zbus::connection::Builder::session()?
                .name("org.mpris.MediaPlayer2.sonolith")?
                .serve_at(PATH, Root(app))?
                .serve_at(PATH, Player(shared))?
                .build()
                .await
        }
        .await;
        match built {
            Ok(c) => {
                let _ = shared.conn.set(c);
            }
            Err(e) => eprintln!("MPRIS unavailable: {e}"),
        }
    });
}

pub struct MprisState(&'static Shared);

#[tauri::command]
pub async fn mpris_update(state: tauri::State<'_, MprisState>, snapshot: Snapshot) -> Result<(), String> {
    let shared = state.0;
    let (old, old_pos, new_pos) = {
        let mut g = shared.inner.lock().unwrap();
        let old_pos = g.position_us();
        let old = g.snap.clone();
        g.snap = snapshot.clone();
        g.anchor = Instant::now();
        (old, old_pos, g.position_us())
    };
    let Some(conn) = shared.conn.get() else { return Ok(()) };

    let mut changed: HashMap<&str, Value<'_>> = HashMap::new();
    let same_track = old.track.as_ref().map(|t| &t.id) == snapshot.track.as_ref().map(|t| &t.id);
    let meta_changed = !same_track
        || old.track.as_ref().map(|t| (t.length_us, &t.art, &t.title)) != snapshot.track.as_ref().map(|t| (t.length_us, &t.art, &t.title));
    if old.status != snapshot.status {
        changed.insert("PlaybackStatus", Value::from(snapshot.status.clone()));
    }
    if old.loop_status != snapshot.loop_status {
        changed.insert("LoopStatus", Value::from(snapshot.loop_status.clone()));
    }
    if old.shuffle != snapshot.shuffle {
        changed.insert("Shuffle", Value::from(snapshot.shuffle));
    }
    if (old.volume - snapshot.volume).abs() > 1e-4 {
        changed.insert("Volume", Value::from(snapshot.volume));
    }
    if meta_changed {
        changed.insert("Metadata", Value::from(metadata(snapshot.track.as_ref())));
    }
    if old.can_next != snapshot.can_next {
        changed.insert("CanGoNext", Value::from(snapshot.can_next));
    }
    if old.can_prev != snapshot.can_prev {
        changed.insert("CanGoPrevious", Value::from(snapshot.can_prev));
    }
    if old.can_seek != snapshot.can_seek {
        changed.insert("CanSeek", Value::from(snapshot.can_seek));
    }
    if old.track.is_some() != snapshot.track.is_some() {
        changed.insert("CanPlay", Value::from(snapshot.track.is_some()));
        changed.insert("CanPause", Value::from(snapshot.track.is_some()));
    }
    let emitter = SignalEmitter::new(conn, PATH).map_err(|e| e.to_string())?;
    if !changed.is_empty() {
        let iface = zbus::names::InterfaceName::try_from(PLAYER_IFACE).map_err(|e| e.to_string())?;
        fdo::Properties::properties_changed(&emitter, iface, changed, std::borrow::Cow::Borrowed(&[]))
            .await
            .map_err(|e| e.to_string())?;
    }
    // Clients extrapolate the position themselves; tell them when it jumped (seek) or the track changed.
    if !same_track || (new_pos - old_pos).abs() > 1_500_000 {
        Player::seeked(&emitter, new_pos).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
