//! Registered apps, blocks and denials, persisted as JSON in the app data dir. Tokens are stored only as hashes.

use super::identity::AppIdentity;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const MINUTE: u64 = 60_000;
pub const HOUR: u64 = 60 * MINUTE;
pub const DAY: u64 = 24 * HOUR;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppRecord {
    pub app_id: String,
    pub name: String,
    pub description: String,
    pub publisher: String,
    pub homepage: Option<String>,
    pub icon: Option<String>,
    pub identity: AppIdentity,
    /// Hex SHA-256 of the token.
    pub token_hash: String,
    pub scopes: Vec<String>,
    pub registered_at: u64,
    pub last_used_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlockRecord {
    pub app_id: String,
    pub identity_key: String,
    pub name: String,
    pub identity: AppIdentity,
    pub blocked_at: u64,
    /// Also blocks the app id, whatever program uses it (an app blocked in Settings). "Deny and block" on a consent
    /// screen blocks only the requesting program, so another program registered under that id keeps working.
    #[serde(default = "app_wide")]
    pub app_wide: bool,
}

/// Blocks saved before `appWide` existed covered the app id too.
fn app_wide() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Denial {
    pub app_id: String,
    pub identity_key: String,
    pub at: u64,
    /// Expiries hold off new requests for a minute; denials escalate.
    pub expired: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    #[serde(default)]
    pub apps: Vec<AppRecord>,
    #[serde(default)]
    pub blocked: Vec<BlockRecord>,
    #[serde(default)]
    pub denials: Vec<Denial>,
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Compares in constant time, so the comparison leaks nothing about where hashes differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A new token: `snl_` + 43 base64url characters (256 random bits).
pub fn new_token() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("OS random source");
    format!("snl_{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

pub fn random_id(prefix: &str) -> String {
    use base64::Engine;
    let mut bytes = [0u8; 9];
    getrandom::fill(&mut bytes).expect("OS random source");
    format!("{prefix}{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

impl Registry {
    pub fn load(path: &Path) -> Registry {
        std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    }

    /// Writes atomically (temp file + rename), readable only by the user.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = tmp_path(path);
        let data = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
        write_private(&tmp, &data)?;
        std::fs::rename(&tmp, path)
    }

    pub fn app(&self, app_id: &str) -> Option<&AppRecord> {
        self.apps.iter().find(|a| a.app_id == app_id)
    }

    pub fn app_mut(&mut self, app_id: &str) -> Option<&mut AppRecord> {
        self.apps.iter_mut().find(|a| a.app_id == app_id)
    }

    pub fn token_matches(&self, app_id: &str, token: &str) -> bool {
        self.app(app_id).is_some_and(|a| same(&a.token_hash, &hash_token(token)))
    }

    pub fn is_blocked(&self, app_id: &str, identity_key: &str) -> bool {
        self.blocked.iter().any(|b| b.identity_key == identity_key || (b.app_wide && b.app_id == app_id))
    }

    /// How long new requests from this app or identity are on hold, if at all (SPEC.md 6.4).
    pub fn cooldown(&self, app_id: &str, identity_key: &str, now: u64) -> Option<u64> {
        let mine: Vec<&Denial> =
            self.denials.iter().filter(|d| d.app_id == app_id || d.identity_key == identity_key).collect();
        let last = mine.iter().max_by_key(|d| d.at)?;
        let hold = if last.expired {
            MINUTE
        } else {
            match mine.iter().filter(|d| !d.expired && d.at + DAY > last.at).count() {
                0 | 1 => 10 * MINUTE,
                2 => HOUR,
                _ => DAY,
            }
        };
        let until = last.at + hold;
        (until > now).then(|| until - now)
    }

    pub fn record_denial(&mut self, app_id: &str, identity_key: &str, now: u64, expired: bool) {
        self.denials.retain(|d| d.at + DAY > now);
        self.denials.push(Denial { app_id: app_id.into(), identity_key: identity_key.into(), at: now, expired });
    }

    pub fn block(&mut self, app_id: &str, name: &str, identity: &AppIdentity, now: u64, app_wide: bool) {
        self.unblock(app_id);
        self.blocked.push(BlockRecord {
            app_id: app_id.into(),
            identity_key: identity.key.clone(),
            name: name.into(),
            identity: identity.clone(),
            blocked_at: now,
            app_wide,
        });
    }

    pub fn unblock(&mut self, app_id: &str) {
        self.blocked.retain(|b| b.app_id != app_id);
        self.denials.retain(|d| d.app_id != app_id);
    }

    pub fn remove(&mut self, app_id: &str) -> Option<AppRecord> {
        let i = self.apps.iter().position(|a| a.app_id == app_id)?;
        Some(self.apps.remove(i))
    }
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

#[cfg(unix)]
fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    f.write_all(data)?;
    f.sync_all()
}

#[cfg(not(unix))]
fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    // The app data dir is inside the user's profile, private to the user by default.
    std::fs::write(path, data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::identity::Kind;

    fn ident(key: &str) -> AppIdentity {
        AppIdentity {
            kind: Kind::Executable,
            key: key.into(),
            executable: key.trim_start_matches("exe:").into(),
            interpreter: None,
            script: None,
            app_image: None,
            flatpak_id: None,
        }
    }

    #[test]
    fn tokens_are_well_formed_and_hashed() {
        let t = new_token();
        assert!(t.starts_with("snl_") && t.len() == 47 && t[4..].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_ne!(t, new_token());
        let mut r = Registry::default();
        r.apps.push(AppRecord {
            app_id: "com.example.a".into(),
            name: "A".into(),
            description: "d".into(),
            publisher: "p".into(),
            homepage: None,
            icon: None,
            identity: ident("exe:/a"),
            token_hash: hash_token(&t),
            scopes: vec![],
            registered_at: 0,
            last_used_at: None,
        });
        assert!(r.token_matches("com.example.a", &t));
        assert!(!r.token_matches("com.example.a", &new_token()));
        assert!(!r.token_matches("com.example.b", &t));
        assert!(!serde_json::to_string(&r).unwrap().contains(&t));
    }

    #[test]
    fn cooldown_escalates_and_expiry_is_short() {
        let mut r = Registry::default();
        let t0 = 1_000_000_000;
        assert_eq!(r.cooldown("a", "exe:/a", t0), None);
        r.record_denial("a", "exe:/a", t0, false);
        assert_eq!(r.cooldown("a", "exe:/a", t0), Some(10 * MINUTE));
        // The same identity under another appId is on hold too.
        assert_eq!(r.cooldown("other", "exe:/a", t0 + MINUTE), Some(9 * MINUTE));
        assert_eq!(r.cooldown("a", "exe:/a", t0 + 10 * MINUTE), None);
        r.record_denial("a", "exe:/a", t0 + 11 * MINUTE, false);
        assert_eq!(r.cooldown("a", "exe:/a", t0 + 11 * MINUTE), Some(HOUR));
        r.record_denial("a", "exe:/a", t0 + 2 * HOUR, false);
        assert_eq!(r.cooldown("a", "exe:/a", t0 + 2 * HOUR), Some(DAY));
        let mut r = Registry::default();
        r.record_denial("b", "exe:/b", t0, true);
        assert_eq!(r.cooldown("b", "exe:/b", t0 + 1000), Some(MINUTE - 1000));
        // Denials older than a day are forgotten.
        let mut r = Registry::default();
        r.record_denial("c", "exe:/c", t0, false);
        r.record_denial("c", "exe:/c", t0 + 2 * DAY, false);
        assert_eq!(r.denials.len(), 1);
        assert_eq!(r.cooldown("c", "exe:/c", t0 + 2 * DAY), Some(10 * MINUTE));
    }

    #[test]
    fn block_by_app_or_identity_and_unblock() {
        let mut r = Registry::default();
        r.block("a", "A", &ident("exe:/a"), 1, true);
        assert!(r.is_blocked("a", "exe:/x"));
        assert!(r.is_blocked("z", "exe:/a"));
        r.unblock("a");
        assert!(!r.is_blocked("a", "exe:/a"));
        // A program blocked from a consent screen: only that program, under any id.
        r.block("b", "B", &ident("exe:/b"), 1, false);
        assert!(r.is_blocked("z", "exe:/b"));
        assert!(!r.is_blocked("b", "exe:/other"));
        // Saved before the field existed: app-wide.
        let old: BlockRecord = serde_json::from_value(serde_json::json!({
            "appId": "c", "identityKey": "exe:/c", "name": "C", "identity": ident("exe:/c"), "blockedAt": 1,
        }))
        .unwrap();
        assert!(old.app_wide);
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("sonolith-api-store-{}", std::process::id()));
        let path = dir.join("apps.json");
        let mut r = Registry::default();
        r.block("a", "A", &ident("exe:/a"), 1, true);
        r.save(&path).unwrap();
        assert_eq!(Registry::load(&path), r);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        std::fs::write(&path, "garbage").unwrap();
        assert_eq!(Registry::load(&path), Registry::default());
        std::fs::remove_dir_all(dir).ok();
    }
}
