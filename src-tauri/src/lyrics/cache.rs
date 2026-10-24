//! Lyrics per video id: in memory, and as small JSON files in the app's cache dir (an LRU by file age and count).
//! "Not found" is cached too, for a shorter time. An entry belongs to a provider setup (order + enabled): changing
//! the setup makes old entries misses.

use super::model::Lyrics;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const FOUND_TTL: u64 = 30 * 24 * 3600;
const MISS_TTL: u64 = 6 * 3600;
/// Files kept on disk (a few kB each); the oldest go first.
const MAX_FILES: usize = 400;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Cached {
    pub provider: Option<String>,
    pub lyrics: Option<Lyrics>,
    pub source: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Entry {
    /// The video id itself: on case-insensitive file systems (Windows, macOS) "abc" and "ABC" share a file.
    #[serde(default)]
    id: String,
    saved: u64,
    setup: String,
    value: Cached,
}

pub struct Cache {
    mem: Mutex<HashMap<String, Entry>>,
    dir: Option<PathBuf>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Video ids are [A-Za-z0-9_-]{11}; anything else never becomes a file name.
fn file_key(id: &str) -> Option<String> {
    (!id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then(|| id.to_string())
}

fn fresh(e: &Entry, setup: &str, at: u64) -> bool {
    let ttl = if e.value.lyrics.is_some() { FOUND_TTL } else { MISS_TTL };
    e.setup == setup && at.saturating_sub(e.saved) < ttl
}

impl Cache {
    pub fn new(dir: Option<PathBuf>) -> Self {
        Cache { mem: Mutex::new(HashMap::new()), dir }
    }

    pub fn get(&self, id: &str, setup: &str) -> Option<Cached> {
        let at = now();
        if let Some(e) = self.mem.lock().unwrap().get(id) {
            return fresh(e, setup, at).then(|| e.value.clone());
        }
        let path = self.dir.as_ref()?.join(format!("{}.json", file_key(id)?));
        let e: Entry = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
        if e.id != id {
            return None;
        }
        let hit = fresh(&e, setup, at).then(|| e.value.clone());
        self.mem.lock().unwrap().insert(id.to_string(), e);
        hit
    }

    pub fn put(&self, id: &str, setup: &str, value: Cached) {
        let e = Entry { id: id.to_string(), saved: now(), setup: setup.to_string(), value };
        if let (Some(dir), Some(key)) = (self.dir.as_ref(), file_key(id)) {
            if std::fs::create_dir_all(dir).is_ok() {
                if let Ok(bytes) = serde_json::to_vec(&e) {
                    let _ = std::fs::write(dir.join(format!("{key}.json")), bytes);
                }
                prune(dir);
            }
        }
        let mut mem = self.mem.lock().unwrap();
        if mem.len() > 200 {
            mem.clear();
        }
        mem.insert(id.to_string(), e);
    }

    pub fn clear(&self) {
        self.mem.lock().unwrap().clear();
        if let Some(dir) = &self.dir {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

/// Over the limit: the least recently written files go.
fn prune(dir: &PathBuf) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(SystemTime, PathBuf)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= MAX_FILES {
        return;
    }
    files.sort();
    for (_, p) in files.iter().take(files.len() - MAX_FILES) {
        let _ = std::fs::remove_file(p);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sonolith-lyrics-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn hits_misses_and_setup_changes() {
        let dir = tmp("hit");
        let c = Cache::new(Some(dir.clone()));
        let v = Cached { provider: Some("lrclib".into()), lyrics: Lyrics::plain("x"), source: None };
        c.put("abcDEF12345", "a,b", v.clone());
        assert_eq!(c.get("abcDEF12345", "a,b"), Some(v.clone()));
        assert_eq!(c.get("abcDEF12345", "b,a"), None);
        // From disk in a fresh cache (app restart).
        assert_eq!(Cache::new(Some(dir.clone())).get("abcDEF12345", "a,b"), Some(v));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ids_differing_only_in_case_never_share_an_entry() {
        let dir = tmp("case");
        let c = Cache::new(Some(dir.clone()));
        c.put("abcDEF12345", "a", Cached { provider: Some("lrclib".into()), lyrics: Lyrics::plain("x"), source: None });
        // What a case-insensitive file system does: the other id's lookup opens this file.
        std::fs::rename(dir.join("abcDEF12345.json"), dir.join("ABCdef12345.json")).unwrap();
        assert_eq!(Cache::new(Some(dir.clone())).get("ABCdef12345", "a"), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn misses_expire_sooner() {
        let e = |found: bool, age: u64| Entry { id: String::new(), saved: 1_000_000 - age, setup: "s".into(), value: Cached { provider: None, lyrics: if found { Lyrics::plain("x") } else { None }, source: None } };
        assert!(fresh(&e(false, 3600), "s", 1_000_000));
        assert!(!fresh(&e(false, MISS_TTL + 1), "s", 1_000_000));
        assert!(fresh(&e(true, MISS_TTL + 1), "s", 1_000_000));
    }

    #[test]
    fn odd_ids_never_touch_the_disk() {
        assert_eq!(file_key("../etc/passwd"), None);
        assert_eq!(file_key("dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
    }

    #[test]
    fn prunes_the_oldest_files() {
        let dir = tmp("prune");
        std::fs::create_dir_all(&dir).unwrap();
        for i in 0..MAX_FILES + 5 {
            std::fs::write(dir.join(format!("{i}.json")), b"{}").unwrap();
        }
        prune(&dir);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), MAX_FILES);
        let _ = std::fs::remove_dir_all(dir);
    }
}
