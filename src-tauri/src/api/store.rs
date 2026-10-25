//! Registered apps, blocks and denials, persisted as JSON in the app data dir. Tokens are stored only as hashes.

use super::identity::AppIdentity;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const MINUTE: u64 = 60_000;
pub const HOUR: u64 = 60 * MINUTE;
pub const DAY: u64 = 24 * HOUR;

/// How long asking again is on hold after the 1st, 2nd and any further denial in a row (SPEC.md 6.4).
pub const DENIAL_HOLDS: [u64; 3] = [MINUTE, 10 * MINUTE, HOUR];
/// After an expiry (nobody answered).
pub const EXPIRY_HOLD: u64 = MINUTE;
/// Denials further apart than this start the count again.
pub const DENIAL_RESET: u64 = DAY;

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
    /// The app's name at the time, for Settings. Missing in denials saved before it existed.
    #[serde(default)]
    pub name: String,
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
    /// Set when an unreadable file could not be moved aside: saving would overwrite it, so nothing is saved.
    #[serde(skip)]
    pub frozen: bool,
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
    /// The saved registry, and what went wrong with it, for Settings. A file that can't be read is renamed to
    /// `<name>.corrupt-<ms>` and the registry starts empty; it is never overwritten, so nothing is lost for good.
    pub fn load(path: &Path) -> (Registry, Option<String>) {
        let failure = match std::fs::read_to_string(path) {
            Ok(text) => match serde_json::from_str(&text) {
                Ok(r) => return (r, None),
                Err(e) => e.to_string(),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (Registry::default(), None),
            Err(e) => e.to_string(),
        };
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(format!(".corrupt-{}", super::server::now_ms()));
        let aside = path.with_file_name(name);
        match std::fs::rename(path, &aside) {
            Ok(()) => {
                let file = aside.file_name().unwrap_or_default().to_string_lossy();
                (Registry::default(), Some(format!("The list of connected apps could not be read ({failure}), so it was set aside as {file}. Apps have to connect again, and apps you blocked are no longer blocked.")))
            }
            Err(e) => (
                Registry { frozen: true, ..Registry::default() },
                Some(format!("The list of connected apps could not be read ({failure}) or set aside ({e}). Until Sonolith restarts, changes to connected apps are not saved.")),
            ),
        }
    }

    /// Writes atomically (temp file + rename), readable only by the user.
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if self.frozen {
            return Ok(());
        }
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

    /// How long new requests from this app or identity are on hold, if at all (SPEC.md 6.4). Denials escalate while
    /// each comes within a day of the one before; an expiry holds for a minute and doesn't count.
    pub fn cooldown(&self, app_id: &str, identity_key: &str, now: u64) -> Option<u64> {
        let mut mine: Vec<&Denial> =
            self.denials.iter().filter(|d| d.app_id == app_id || d.identity_key == identity_key).collect();
        mine.sort_by_key(|d| std::cmp::Reverse(d.at));
        let last = mine.first()?;
        let hold = if last.expired {
            EXPIRY_HOLD
        } else {
            let mut streak = 0;
            let mut next = last.at;
            for d in mine.iter().filter(|d| !d.expired) {
                if next - d.at > DENIAL_RESET {
                    break;
                }
                streak += 1;
                next = d.at;
            }
            DENIAL_HOLDS[(streak - 1).min(DENIAL_HOLDS.len() - 1)]
        };
        let until = last.at + hold;
        (until > now).then(|| until - now)
    }

    pub fn record_denial(&mut self, app_id: &str, identity_key: &str, name: &str, now: u64, expired: bool) {
        self.denials.retain(|d| d.at + DENIAL_RESET > now);
        self.denials.push(Denial { app_id: app_id.into(), identity_key: identity_key.into(), at: now, expired, name: name.into() });
    }

    /// Forgets the denials of an app and of the programs that asked under its id: after an approval, or when the user
    /// lets it ask again from Settings.
    pub fn forget_denials(&mut self, app_id: &str, identity_key: Option<&str>) {
        let keys: Vec<String> = self
            .denials
            .iter()
            .filter(|d| d.app_id == app_id)
            .map(|d| d.identity_key.clone())
            .chain(identity_key.map(String::from))
            .collect();
        self.denials.retain(|d| d.app_id != app_id && !keys.contains(&d.identity_key));
    }

    /// Apps on hold right now, newest denial per app id, with the time left.
    pub fn on_hold(&self, now: u64) -> Vec<(&Denial, u64)> {
        let mut seen: Vec<&str> = Vec::new();
        let mut latest: Vec<&Denial> = self.denials.iter().collect();
        latest.sort_by_key(|d| std::cmp::Reverse(d.at));
        latest
            .into_iter()
            .filter(|d| {
                let new = !seen.contains(&d.app_id.as_str());
                seen.push(&d.app_id);
                new
            })
            .filter_map(|d| self.cooldown(&d.app_id, &d.identity_key, now).map(|w| (d, w)))
            .collect()
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

/// Writes a new file readable only by the user (a temp file, renamed into place after). A leftover from a crash is
/// removed first (a link is removed, not followed); the file is then created fresh (O_EXCL, O_NOFOLLOW), so a link
/// planted in between makes the write fail instead of writing through it.
pub(super) fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let _ = std::fs::remove_file(path);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    // On Windows the app data dir is inside the user's profile, private to the user by default.
    let mut f = options.open(path)?;
    f.write_all(data)?;
    f.sync_all()
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
        r.record_denial("a", "exe:/a", "A", t0, false);
        assert_eq!(r.cooldown("a", "exe:/a", t0), Some(MINUTE));
        // The same identity under another appId is on hold too.
        assert_eq!(r.cooldown("other", "exe:/a", t0 + 20_000), Some(40_000));
        assert_eq!(r.cooldown("a", "exe:/a", t0 + MINUTE), None);
        r.record_denial("a", "exe:/a", "A", t0 + 2 * MINUTE, false);
        assert_eq!(r.cooldown("a", "exe:/a", t0 + 2 * MINUTE), Some(10 * MINUTE));
        r.record_denial("a", "exe:/a", "A", t0 + HOUR, false);
        assert_eq!(r.cooldown("a", "exe:/a", t0 + HOUR), Some(HOUR));
        // Capped at an hour.
        r.record_denial("a", "exe:/a", "A", t0 + 3 * HOUR, false);
        assert_eq!(r.cooldown("a", "exe:/a", t0 + 3 * HOUR), Some(HOUR));
        // An expiry holds for a minute, whatever came before.
        let mut r = Registry::default();
        r.record_denial("b", "exe:/b", "B", t0, true);
        assert_eq!(r.cooldown("b", "exe:/b", t0 + 1000), Some(MINUTE - 1000));
        r.record_denial("b", "exe:/b", "B", t0 + MINUTE, false);
        assert_eq!(r.cooldown("b", "exe:/b", t0 + MINUTE), Some(MINUTE), "expiries don't escalate");
    }

    #[test]
    fn a_day_without_a_denial_starts_the_count_again() {
        let mut r = Registry::default();
        let t0 = 1_000_000_000;
        r.record_denial("c", "exe:/c", "C", t0, false);
        r.record_denial("c", "exe:/c", "C", t0 + HOUR, false);
        assert_eq!(r.cooldown("c", "exe:/c", t0 + HOUR), Some(10 * MINUTE));
        r.record_denial("c", "exe:/c", "C", t0 + HOUR + DAY + 1, false);
        assert_eq!(r.denials.len(), 1);
        assert_eq!(r.cooldown("c", "exe:/c", t0 + HOUR + DAY + 1), Some(MINUTE));
        // A chain of denials each within a day keeps escalating even past 24 h in total.
        let mut r = Registry::default();
        r.record_denial("d", "exe:/d", "D", t0, false);
        r.denials.push(Denial { app_id: "d".into(), identity_key: "exe:/d".into(), at: t0 + 20 * HOUR, expired: false, name: "D".into() });
        r.denials.push(Denial { app_id: "d".into(), identity_key: "exe:/d".into(), at: t0 + 40 * HOUR, expired: false, name: "D".into() });
        assert_eq!(r.cooldown("d", "exe:/d", t0 + 40 * HOUR), Some(HOUR));
    }

    #[test]
    fn forgetting_denials_clears_the_hold() {
        let mut r = Registry::default();
        let t0 = 1_000_000_000;
        r.record_denial("a", "exe:/a", "A", t0, false);
        r.record_denial("b", "exe:/b", "B", t0, false);
        // The same program asked under another id: forgetting "a" frees it as well.
        r.record_denial("a2", "exe:/a", "A", t0 + 1, false);
        assert_eq!(r.on_hold(t0 + 1).len(), 3);
        r.forget_denials("a", None);
        assert_eq!(r.cooldown("a", "exe:/a", t0 + 1), None);
        assert_eq!(r.cooldown("a2", "exe:/x", t0 + 1), None);
        let held = r.on_hold(t0 + 1);
        assert_eq!(held.len(), 1);
        assert_eq!((held[0].0.name.as_str(), held[0].1), ("B", MINUTE - 1));
        // After an approval, by identity too.
        r.record_denial("z", "exe:/b", "B", t0 + 2, false);
        r.forget_denials("b", Some("exe:/b"));
        assert!(r.denials.is_empty());
        // Denials saved before the name existed still load.
        let old: Denial = serde_json::from_value(serde_json::json!({"appId": "a", "identityKey": "k", "at": 1, "expired": false})).unwrap();
        assert_eq!(old.name, "");
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
        assert_eq!(Registry::load(&path).0, r);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert_eq!(Registry::load(&path), (r, None));
        std::fs::remove_dir_all(dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn saving_never_follows_a_planted_temp_file_link() {
        let dir = std::env::temp_dir().join(format!("sonolith-api-store-link-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let victim = dir.join("victim");
        std::fs::write(&victim, "precious").unwrap();
        let path = dir.join("apps.json");
        std::os::unix::fs::symlink(&victim, tmp_path(&path)).unwrap();
        Registry::default().save(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "precious");
        assert_eq!(Registry::load(&path), (Registry::default(), None));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_corrupted_file_is_set_aside_not_overwritten() {
        let dir = std::env::temp_dir().join(format!("sonolith-api-store-corrupt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("apps.json");
        std::fs::write(&path, "{\"apps\": [garbage").unwrap();
        let (r, problem) = Registry::load(&path);
        assert!(r.apps.is_empty() && !r.frozen);
        assert!(problem.unwrap().contains("set aside as apps.json.corrupt-"));
        r.save(&path).unwrap();
        let kept = std::fs::read_dir(&dir).unwrap().filter(|e| std::fs::read_to_string(e.as_ref().unwrap().path()).unwrap() == "{\"apps\": [garbage").count();
        assert_eq!(kept, 1, "the unreadable file must survive");
        std::fs::remove_dir_all(dir).ok();
    }
}
