//! Every method's scope, rate class and handler, and every topic's scope. A test checks this table against
//! api/openrpc.json, so the server and the spec cannot drift apart.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rate {
    Local,
    Control,
    Network,
    Account,
    Auth,
}

impl Rate {
    #[cfg(test)]
    pub fn name(self) -> &'static str {
        match self {
            Rate::Local => "local",
            Rate::Control => "control",
            Rate::Network => "network",
            Rate::Account => "account",
            Rate::Auth => "auth",
        }
    }
    /// Refill per second and bucket size (SPEC.md 12.1).
    pub fn bucket(self) -> (f64, f64) {
        match self {
            Rate::Local => (50.0, 100.0),
            Rate::Control => (10.0, 20.0),
            Rate::Network => (2.0, 10.0),
            Rate::Account => (0.5, 5.0),
            Rate::Auth => (1.0, 5.0),
        }
    }
}

/// Who answers a method.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handler {
    /// The server itself (registration, sessions, events, cached player state).
    Server,
    /// The frontend, through the bridge.
    Frontend,
}

pub struct Method {
    pub name: &'static str,
    /// Any of these scopes allows the method; empty = no scope needed.
    pub scopes: &'static [&'static str],
    pub rate: Rate,
    pub session: bool,
    pub handler: Handler,
}

const fn m(name: &'static str, scopes: &'static [&'static str], rate: Rate, handler: Handler) -> Method {
    Method { name, scopes, rate, session: true, handler }
}

use Handler::{Frontend as F, Server as S};
use Rate::*;

pub const METHODS: &[Method] = &[
    Method { name: "app.info", scopes: &[], rate: Local, session: false, handler: S },
    Method { name: "app.register", scopes: &[], rate: Auth, session: false, handler: S },
    m("app.requestScopes", &[], Auth, S),
    m("app.unregister", &[], Auth, S),
    Method { name: "session.hello", scopes: &[], rate: Auth, session: false, handler: S },
    m("events.subscribe", &[], Local, S),
    m("events.unsubscribe", &[], Local, S),
    m("player.getState", &["player:read"], Local, S),
    m("player.play", &["player:control"], Control, F),
    m("player.pause", &["player:control"], Control, F),
    m("player.toggle", &["player:control"], Control, F),
    m("player.next", &["player:control"], Control, F),
    m("player.previous", &["player:control"], Control, F),
    m("player.seek", &["player:control"], Control, F),
    m("player.setVolume", &["player:control"], Control, F),
    m("player.setShuffle", &["player:control"], Control, F),
    m("player.setRepeat", &["player:control"], Control, F),
    m("player.setRate", &["player:control"], Control, F),
    m("player.playItem", &["player:control"], Control, F),
    m("queue.get", &["queue:read"], Local, F),
    m("queue.add", &["queue:write"], Control, F),
    m("queue.playNext", &["queue:write"], Control, F),
    m("queue.move", &["queue:write"], Control, F),
    m("queue.remove", &["queue:write"], Control, F),
    m("queue.clear", &["queue:write"], Control, F),
    m("queue.setAutoplay", &["queue:write"], Control, F),
    m("library.playlists", &["library:read"], Network, F),
    m("library.likedSongs", &["library:read"], Network, F),
    m("library.albums", &["library:read"], Network, F),
    m("library.artists", &["library:read"], Network, F),
    m("library.podcasts", &["library:read"], Network, F),
    m("library.episodesForLater", &["library:read"], Network, F),
    m("library.history", &["library:read"], Network, F),
    m("playlist.get", &["library:read", "search"], Network, F),
    m("playlist.create", &["library:write"], Account, F),
    m("playlist.rename", &["library:write"], Account, F),
    m("playlist.delete", &["library:write"], Account, F),
    m("playlist.addTracks", &["library:write"], Account, F),
    m("playlist.removeTracks", &["library:write"], Account, F),
    m("search.query", &["search"], Network, F),
    m("search.suggestions", &["search"], Network, F),
    m("browse.album", &["search"], Network, F),
    m("browse.artist", &["search"], Network, F),
    m("browse.podcast", &["search"], Network, F),
    m("browse.episode", &["search"], Network, F),
    m("rating.set", &["library:write"], Account, F),
    m("lyrics.get", &["lyrics:read"], Network, F),
];

pub fn find(name: &str) -> Option<&'static Method> {
    METHODS.iter().find(|m| m.name == name)
}

pub const SCOPES: &[&str] =
    &["player:read", "player:control", "queue:read", "queue:write", "library:read", "library:write", "search", "lyrics:read"];

/// Topics and the scope each needs (None = any session).
pub const TOPICS: &[(&str, Option<&str>)] = &[
    ("player.state", Some("player:read")),
    ("player.track", Some("player:read")),
    ("player.position", Some("player:read")),
    ("player.volume", Some("player:read")),
    ("queue", Some("queue:read")),
    ("lyrics", Some("lyrics:read")),
    ("lyrics.line", Some("lyrics:read")),
    ("lyrics.word", Some("lyrics:read")),
    ("account", None),
];

pub fn topic_scope(topic: &str) -> Option<Option<&'static str>> {
    TOPICS.iter().find(|(t, _)| *t == topic).map(|(_, s)| *s)
}

/// Labels the user sees for each scope (SPEC.md section 8).
pub fn scope_label(scope: &str) -> &'static str {
    match scope {
        "player:read" => "See what's playing",
        "player:control" => "Control playback",
        "queue:read" => "See your queue",
        "queue:write" => "Change your queue",
        "library:read" => "Access your library",
        "library:write" => "Change your library",
        "search" => "Search YouTube Music",
        "lyrics:read" => "Show lyrics",
        _ => "",
    }
}

pub fn scope_sensitive(scope: &str) -> bool {
    scope == "library:write"
}

/// Token buckets per rate class.
pub struct Buckets {
    state: [(f64, std::time::Instant); 5],
}

impl Default for Buckets {
    fn default() -> Self {
        let now = std::time::Instant::now();
        let all = [Local, Control, Network, Account, Auth];
        Buckets { state: all.map(|r| (r.bucket().1, now)) }
    }
}

impl Buckets {
    /// Takes one token; Err(ms to wait) when the bucket is empty.
    pub fn take(&mut self, rate: Rate, now: std::time::Instant) -> Result<(), u64> {
        let i = rate as usize;
        let (per_sec, size) = rate.bucket();
        let (tokens, at) = &mut self.state[i];
        *tokens = (*tokens + now.duration_since(*at).as_secs_f64() * per_sec).min(size);
        *at = now;
        if *tokens >= 1.0 {
            *tokens -= 1.0;
            Ok(())
        } else {
            Err((((1.0 - *tokens) / per_sec) * 1000.0).ceil() as u64)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn openrpc() -> Value {
        serde_json::from_str(include_str!("../../../api/openrpc.json")).unwrap()
    }

    #[test]
    fn table_matches_the_spec() {
        let doc = openrpc();
        let spec: Vec<&Value> = doc["methods"].as_array().unwrap().iter().collect();
        assert_eq!(spec.len(), METHODS.len(), "method count");
        for s in spec {
            let name = s["name"].as_str().unwrap();
            let m = find(name).unwrap_or_else(|| panic!("{name} missing in METHODS"));
            assert_eq!(s["x-rate-class"], m.rate.name(), "{name} rate");
            assert_eq!(s["x-requires-session"], m.session, "{name} session");
            let scopes: Vec<String> = match &s["x-scope"] {
                Value::Null => vec![],
                Value::String(x) => vec![x.clone()],
                Value::Array(a) => a.iter().map(|x| x.as_str().unwrap().to_string()).collect(),
                _ => unreachable!(),
            };
            assert_eq!(scopes, m.scopes, "{name} scopes");
        }
        let topics: Vec<(String, Option<String>)> = doc["x-events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| !e["topic"].is_null())
            .map(|e| (e["topic"].as_str().unwrap().into(), e["scope"].as_str().map(String::from)))
            .collect();
        let ours: Vec<(String, Option<String>)> = TOPICS.iter().map(|(t, s)| (t.to_string(), s.map(String::from))).collect();
        assert_eq!(topics, ours);
        let scopes: Vec<&str> = doc["x-scopes"].as_array().unwrap().iter().map(|s| s["scope"].as_str().unwrap()).collect();
        assert_eq!(scopes, SCOPES);
        for s in doc["x-scopes"].as_array().unwrap() {
            let id = s["scope"].as_str().unwrap();
            assert_eq!(s["label"], scope_label(id));
            assert_eq!(s["sensitive"], scope_sensitive(id));
        }
    }

    #[test]
    fn buckets_refill() {
        let mut b = Buckets::default();
        let t = std::time::Instant::now();
        for _ in 0..5 {
            assert!(b.take(Account, t).is_ok());
        }
        let wait = b.take(Account, t).unwrap_err();
        assert!(wait > 1900 && wait <= 2000, "{wait}");
        assert!(b.take(Account, t + std::time::Duration::from_secs(2)).is_ok());
        for _ in 0..100 {
            assert!(b.take(Local, t).is_ok());
        }
        assert!(b.take(Local, t).is_err());
    }
}
