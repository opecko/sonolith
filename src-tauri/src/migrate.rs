//! One-time copy of an install made under the app's old name (ytdesk, identifier `dev.ytdesk.app`) into the
//! directories of the current identifier: the webview profile (localStorage, cookies), config.json, the managed
//! yt-dlp, the lyrics cache and the logs. Runs before the Tauri builder, because Tauri creates the configured
//! window (and with it the webview's data directory) before the app's own setup runs.
//!
//! The old directories are copied, never moved, so going back to an older ytdesk still finds everything. Each
//! directory is copied into a temporary sibling first and renamed into place, so an interrupted copy never leaves
//! a half-filled directory that would look like a finished one. A marker file makes the check a single stat on
//! later launches; it's written only once every directory made it, so a failed copy is retried next time.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// The identifier every ytdesk release used.
pub const OLD_IDENTIFIER: &str = "dev.ytdesk.app";
/// In the new local data directory once the migration is done (or there was nothing to migrate).
const MARKER: &str = ".migrated-from-ytdesk";
/// Browser HTTP / shader caches: large, rebuilt on demand, and not worth a slower first launch.
const SKIPPED_DIRS: &[&str] =
    &["WebKitCache", "Cache", "Code Cache", "GPUCache", "GrShaderCache", "ShaderCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache"];
/// A temporary copy older than this was left by a launch that died mid-copy.
const STALE_TEMP: Duration = Duration::from_secs(10 * 60);

/// One app directory to copy: `<root>/dev.ytdesk.app` → `<root>/<identifier>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pair {
    pub from: PathBuf,
    pub to: PathBuf,
}

/// The app directories of `identifier` under each base directory (data, local data, config, cache; on Linux data
/// and local data are the same, on Windows local data and cache), paired with the old ones. Duplicates removed.
pub fn pairs(roots: &[PathBuf], identifier: &str) -> Vec<Pair> {
    let mut out: Vec<Pair> = Vec::new();
    for root in roots {
        let pair = Pair { from: root.join(OLD_IDENTIFIER), to: root.join(identifier) };
        if !out.contains(&pair) {
            out.push(pair);
        }
    }
    out
}

/// What to copy: nothing once the marker exists (or when the identifier didn't change), otherwise every pair whose
/// old directory exists and whose new one doesn't. An existing new directory is never overwritten.
pub fn plan(pairs: &[Pair], marker: &Path, exists: impl Fn(&Path) -> bool) -> Vec<Pair> {
    if exists(marker) {
        return Vec::new();
    }
    pairs.iter().filter(|p| p.from != p.to && exists(&p.from) && !exists(&p.to)).cloned().collect()
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct CopyStats {
    pub files: u64,
    pub bytes: u64,
    /// Source files that couldn't be read (e.g. a lock file held by a running ytdesk on Windows).
    pub unreadable: Vec<PathBuf>,
}

/// Copies the tree at `from` into the new directory `to`. Skips browser caches; a source file that can't be read is
/// left out and reported, but a failed write is an error (disk full, permissions).
fn copy_tree(from: &Path, to: &Path, stats: &mut CopyStats) -> io::Result<()> {
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            if !SKIPPED_DIRS.iter().any(|d| entry.file_name() == *d) {
                copy_tree(&src, &dst, stats)?;
            }
        } else if kind.is_symlink() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(fs::read_link(&src)?, &dst)?;
        } else {
            let mut input = match fs::File::open(&src) {
                Ok(f) => f,
                Err(_) => {
                    stats.unreadable.push(src);
                    continue;
                }
            };
            let mut output = fs::File::create(&dst)?;
            let n = match io::copy(&mut input, &mut output) {
                Ok(n) => n,
                // Reading can still fail midway (a locked range); writing failing is the destination's problem.
                Err(e) if e.kind() == io::ErrorKind::StorageFull => return Err(e),
                Err(_) => {
                    drop(output);
                    fs::remove_file(&dst)?;
                    stats.unreadable.push(src);
                    continue;
                }
            };
            fs::set_permissions(&dst, input.metadata()?.permissions())?;
            stats.files += 1;
            stats.bytes += n;
        }
    }
    Ok(())
}

fn temp_prefix(to: &Path) -> String {
    format!(".{}.migrating-", to.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}

/// Removes temporary copies an earlier, interrupted launch left next to `to` (not a concurrent launch's fresh one).
fn remove_stale_temps(to: &Path) {
    let (Some(parent), prefix) = (to.parent(), temp_prefix(to)) else { return };
    let Ok(entries) = fs::read_dir(parent) else { return };
    for e in entries.flatten() {
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok());
        if e.file_name().to_string_lossy().starts_with(&prefix) && old.is_some_and(|age| age > STALE_TEMP) {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

/// Copies one pair through a temporary sibling. Another launch finishing first counts as success.
pub fn copy_pair(pair: &Pair) -> io::Result<CopyStats> {
    remove_stale_temps(&pair.to);
    if let Some(parent) = pair.to.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = pair.to.with_file_name(format!("{}{}", temp_prefix(&pair.to), std::process::id()));
    let _ = fs::remove_dir_all(&temp);
    let mut stats = CopyStats::default();
    let copied = copy_tree(&pair.from, &temp, &mut stats).and_then(|()| fs::rename(&temp, &pair.to));
    match copied {
        Ok(()) => Ok(stats),
        Err(_) if pair.to.exists() => {
            let _ = fs::remove_dir_all(&temp);
            Ok(stats)
        }
        Err(e) => {
            let _ = fs::remove_dir_all(&temp);
            Err(e)
        }
    }
}

/// Plans and copies; returns the log lines. Writes the marker into `marker_dir` when everything succeeded.
pub fn migrate(roots: &[PathBuf], identifier: &str, marker_dir: &Path) -> Vec<String> {
    let marker = marker_dir.join(MARKER);
    if identifier == OLD_IDENTIFIER || marker.exists() {
        return Vec::new();
    }
    let todo = plan(&pairs(roots, identifier), &marker, |p| p.exists());
    let mut log = Vec::new();
    let mut ok = true;
    for pair in &todo {
        match copy_pair(pair) {
            Ok(s) => {
                log.push(format!("migrate: copied {} → {} ({} files, {} KB)", pair.from.display(), pair.to.display(), s.files, s.bytes / 1024));
                for f in &s.unreadable {
                    log.push(format!("migrate: skipped unreadable {}", f.display()));
                }
            }
            Err(e) => {
                ok = false;
                log.push(format!("migrate: copying {} failed: {e}; retrying on the next launch", pair.from.display()));
            }
        }
    }
    if ok {
        let note = if todo.is_empty() { "nothing to migrate" } else { "done" };
        match fs::create_dir_all(marker_dir).and_then(|()| fs::write(&marker, format!("{note}\n"))) {
            Ok(()) if todo.is_empty() => {} // a fresh install: nothing worth logging
            Ok(()) => log.push(format!("migrate: {note}")),
            Err(e) => log.push(format!("migrate: cannot write the marker: {e}")),
        }
    }
    log
}

/// The startup entry point: the app's base directories as Tauri resolves them (`app_*_dir` = base/identifier).
pub fn run(identifier: &str) {
    let roots: Vec<PathBuf> = [dirs::data_dir(), dirs::data_local_dir(), dirs::config_dir(), dirs::cache_dir()].into_iter().flatten().collect();
    let Some(local) = dirs::data_local_dir().map(|d| d.join(identifier)) else { return };
    for line in migrate(&roots, identifier, &local) {
        eprintln!("{line}");
        let _ = crate::append_playback_log(&crate::playback_log_path(Some(local.join("logs"))), &line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NEW: &str = "dev.sonolith.app";

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sonolith-migrate-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn pairs_are_deduplicated() {
        let roots = [PathBuf::from("/d"), PathBuf::from("/d"), PathBuf::from("/c")];
        let p = pairs(&roots, NEW);
        assert_eq!(p, vec![
            Pair { from: "/d/dev.ytdesk.app".into(), to: "/d/dev.sonolith.app".into() },
            Pair { from: "/c/dev.ytdesk.app".into(), to: "/c/dev.sonolith.app".into() },
        ]);
    }

    #[test]
    fn plan_copies_only_old_dirs_without_a_new_one() {
        let p = pairs(&[PathBuf::from("/a"), PathBuf::from("/b"), PathBuf::from("/c")], NEW);
        let marker = Path::new("/a/dev.sonolith.app/.migrated-from-ytdesk");
        // /a: old and no new → copy. /b: old and new → keep new. /c: no old → nothing.
        let existing = ["/a/dev.ytdesk.app", "/b/dev.ytdesk.app", "/b/dev.sonolith.app"];
        let todo = plan(&p, marker, |x| existing.iter().any(|e| Path::new(e) == x));
        assert_eq!(todo, vec![p[0].clone()]);
    }

    #[test]
    fn plan_is_empty_once_marked_or_unrenamed() {
        let p = pairs(&[PathBuf::from("/a")], NEW);
        let marker = Path::new("/a/dev.sonolith.app/.migrated-from-ytdesk");
        assert!(plan(&p, marker, |x| x == marker || x == Path::new("/a/dev.ytdesk.app")).is_empty());
        let same = pairs(&[PathBuf::from("/a")], OLD_IDENTIFIER);
        assert!(plan(&same, marker, |_| false).is_empty());
    }

    #[test]
    fn copies_everything_once_and_keeps_the_old_dirs() {
        let root = temp("copy");
        let data = root.join("data");
        let cache = root.join("cache");
        let old = data.join(OLD_IDENTIFIER);
        fs::create_dir_all(old.join("localstorage")).unwrap();
        fs::create_dir_all(old.join("WebKitCache")).unwrap();
        fs::create_dir_all(old.join("bin")).unwrap();
        fs::write(old.join("localstorage/tauri_localhost_0.localstorage"), b"settings").unwrap();
        fs::write(old.join("WebKitCache/blob"), b"cache").unwrap();
        fs::write(old.join("bin/yt-dlp"), b"#!/bin/sh").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(old.join("bin/yt-dlp"), fs::Permissions::from_mode(0o755)).unwrap();
        }
        fs::create_dir_all(cache.join(OLD_IDENTIFIER).join("lyrics")).unwrap();
        fs::write(cache.join(OLD_IDENTIFIER).join("lyrics/x.json"), b"{}").unwrap();

        let roots = [data.clone(), data.clone(), cache.clone()];
        let marker_dir = data.join(NEW);
        let log = migrate(&roots, NEW, &marker_dir);
        assert_eq!(log.len(), 3, "{log:?}");

        let new = data.join(NEW);
        assert_eq!(fs::read(new.join("localstorage/tauri_localhost_0.localstorage")).unwrap(), b"settings");
        assert!(!new.join("WebKitCache").exists());
        assert_eq!(fs::read(cache.join(NEW).join("lyrics/x.json")).unwrap(), b"{}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(new.join("bin/yt-dlp")).unwrap().permissions().mode() & 0o777, 0o755);
        }
        assert!(old.join("localstorage/tauri_localhost_0.localstorage").exists(), "old data stays for a downgrade");
        assert!(new.join(MARKER).exists());
        assert!(fs::read_dir(&data).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().contains("migrating")));

        // Marked: a second launch copies nothing, even into a directory removed since.
        fs::remove_dir_all(cache.join(NEW)).unwrap();
        assert!(migrate(&roots, NEW, &marker_dir).is_empty());
        assert!(!cache.join(NEW).exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_fresh_install_is_marked_silently() {
        let root = temp("fresh");
        let marker_dir = root.join(NEW);
        assert!(migrate(&[root.clone()], NEW, &marker_dir).is_empty());
        assert!(marker_dir.join(MARKER).exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_failed_copy_leaves_no_new_dir_and_no_marker() {
        let root = temp("fail");
        let old = root.join(OLD_IDENTIFIER);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("a"), b"a").unwrap();
        // The new directory's parent is a file, so creating the temporary copy fails.
        let blocked = root.join("blocked");
        fs::write(&blocked, b"").unwrap();
        let pair = Pair { from: old.clone(), to: blocked.join(NEW) };
        assert!(copy_pair(&pair).is_err());
        assert!(!pair.to.exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_interrupted_copy_is_replaced() {
        let root = temp("interrupted");
        let old = root.join(OLD_IDENTIFIER);
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("a"), b"a").unwrap();
        // A half-done temporary copy from a crashed launch with another pid: the real directory doesn't exist yet.
        let stale = root.join(format!(".{NEW}.migrating-1"));
        fs::create_dir_all(&stale).unwrap();
        let log = migrate(&[root.clone()], NEW, &root.join(NEW));
        assert_eq!(log.len(), 2, "{log:?}");
        assert_eq!(fs::read(root.join(NEW).join("a")).unwrap(), b"a");
        fs::remove_dir_all(&root).unwrap();
    }
}
