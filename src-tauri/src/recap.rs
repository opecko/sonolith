//! Recaps storage under `<app data dir>/recap/`: the local play log (`log/YYYY-MM.jsonl`, append-only JSON lines
//! written by the frontend's play log) and small JSON files the frontend keeps (history import cache, frozen recap
//! snapshots, created playlist ids). Names are checked against fixed patterns, so the frontend can't reach outside
//! the folder. All commands are async: file I/O never runs on the GTK thread, and appends never wait on playback.
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// One writer at a time, so checkpoint lines never interleave.
static WRITE: Mutex<()> = Mutex::new(());

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("recap")).map_err(|e| e.to_string())
}

/// "2026-11".
fn valid_month(m: &str) -> bool {
    let b = m.as_bytes();
    b.len() == 7 && b[4] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || c.is_ascii_digit())
}

/// "history.json", "snapshots/month-2026-10.json": lowercase letters, digits, `-`, `_`, at most one folder.
fn valid_name(n: &str) -> bool {
    let Some(stem) = n.strip_suffix(".json") else { return false };
    let parts: Vec<&str> = stem.split('/').collect();
    parts.len() <= 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 64
                && p.as_bytes()[0].is_ascii_alphanumeric()
                && p.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_')
        })
}

fn valid_dir(d: &str) -> bool {
    !d.is_empty() && d.len() <= 64 && d.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-' || c == b'_')
}

pub(crate) fn append_log(root: &Path, month: &str, text: &str) -> Result<(), String> {
    if !valid_month(month) {
        return Err("bad month".into());
    }
    let dir = root.join("log");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    let path = dir.join(format!("{month}.jsonl"));
    let mut f = OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    // A torn last line (crash mid-write) would glue onto this one: start on a fresh line if the file doesn't end
    // with one. The reader skips the torn line.
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut out = String::with_capacity(text.len() + 2);
    if len > 0 && !ends_with_newline(&path) {
        out.push('\n');
    }
    out.push_str(text.trim_end_matches('\n'));
    out.push('\n');
    f.write_all(out.as_bytes()).map_err(|e| e.to_string())
}

fn ends_with_newline(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = fs::File::open(path) else { return true };
    let mut b = [0u8; 1];
    f.seek(SeekFrom::End(-1)).is_err() || (f.read_exact(&mut b).is_ok() && b[0] == b'\n')
}

#[derive(serde::Serialize)]
pub struct LogFile {
    month: String,
    text: String,
}

pub(crate) fn read_log(root: &Path) -> Vec<LogFile> {
    let mut out: Vec<LogFile> = fs::read_dir(root.join("log"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let month = name.strip_suffix(".jsonl")?;
            if !valid_month(month) {
                return None;
            }
            let text = fs::read_to_string(e.path()).ok()?;
            Some(LogFile { month: month.to_string(), text })
        })
        .collect();
    out.sort_by(|a, b| a.month.cmp(&b.month));
    out
}

/// Writes through a temp file and a rename, so a crash never leaves half a snapshot.
pub(crate) fn write_file(root: &Path, name: &str, text: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("bad name".into());
    }
    let path = root.join(name);
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub(crate) fn read_file(root: &Path, name: &str) -> Result<Option<String>, String> {
    if !valid_name(name) {
        return Err("bad name".into());
    }
    match fs::read_to_string(root.join(name)) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn list_dir(root: &Path, dir: &str) -> Result<Vec<String>, String> {
    if !valid_dir(dir) {
        return Err("bad folder".into());
    }
    let mut names: Vec<String> = fs::read_dir(root.join(dir))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(".json"))
        .map(|n| format!("{dir}/{n}"))
        .collect();
    names.sort();
    Ok(names)
}

fn remove(path: &Path) -> Result<(), String> {
    let r = if path.is_dir() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
    match r {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[tauri::command(async)]
pub fn recap_log_append(app: AppHandle, month: String, text: String) -> Result<(), String> {
    append_log(&root(&app)?, &month, &text)
}

#[tauri::command(async)]
pub fn recap_log_read(app: AppHandle) -> Result<Vec<LogFile>, String> {
    Ok(read_log(&root(&app)?))
}

#[tauri::command(async)]
pub fn recap_log_delete(app: AppHandle) -> Result<(), String> {
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    remove(&root(&app)?.join("log"))
}

/// Saves the exported log (JSON made by the frontend) into the Downloads folder under a fixed name and returns the
/// path. Only the date part of the name comes from the frontend, and it must be a date.
#[tauri::command(async)]
pub fn recap_log_export(app: AppHandle, date: String, text: String) -> Result<String, String> {
    let ok = date.len() == 10 && date.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() });
    if !ok {
        return Err("bad date".into());
    }
    let dir = dirs::download_dir().or_else(|| app.path().app_data_dir().ok()).ok_or("no folder to save into")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("sonolith-listening-log-{date}.json"));
    fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn recap_file_read(app: AppHandle, name: String) -> Result<Option<String>, String> {
    read_file(&root(&app)?, &name)
}

#[tauri::command(async)]
pub fn recap_file_write(app: AppHandle, name: String, text: String) -> Result<(), String> {
    write_file(&root(&app)?, &name, &text)
}

#[tauri::command(async)]
pub fn recap_file_delete(app: AppHandle, name: String) -> Result<(), String> {
    if !valid_name(&name) {
        return Err("bad name".into());
    }
    remove(&root(&app)?.join(name))
}

#[tauri::command(async)]
pub fn recap_file_list(app: AppHandle, dir: String) -> Result<Vec<String>, String> {
    list_dir(&root(&app)?, &dir)
}

/// Settings → Recaps → Delete all recap data: the log, the history import, snapshots, everything.
#[tauri::command(async)]
pub fn recap_delete_all(app: AppHandle) -> Result<(), String> {
    let _g = WRITE.lock().unwrap_or_else(|e| e.into_inner());
    remove(&root(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sonolith-recap-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn names() {
        assert!(valid_month("2026-11"));
        assert!(!valid_month("2026-1"));
        assert!(!valid_month("../2026"));
        assert!(valid_name("history.json"));
        assert!(valid_name("snapshots/month-2026-10.json"));
        assert!(!valid_name("../x.json"));
        assert!(!valid_name("a/b/c.json"));
        assert!(!valid_name("/etc.json"));
        assert!(!valid_name("A.json"));
        assert!(!valid_name("x.txt"));
        assert!(!valid_dir(".."));
    }

    #[test]
    fn append_and_read_with_a_torn_line() {
        let root = temp("log");
        append_log(&root, "2026-11", "{\"a\":1}").unwrap();
        // A crash mid-write leaves a line without its newline.
        let p = root.join("log/2026-11.jsonl");
        let mut f = OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"{\"torn").unwrap();
        append_log(&root, "2026-11", "{\"b\":2}\n").unwrap();
        append_log(&root, "2026-10", "{\"c\":3}").unwrap();
        let files = read_log(&root);
        assert_eq!(files.iter().map(|f| f.month.as_str()).collect::<Vec<_>>(), ["2026-10", "2026-11"]);
        assert_eq!(files[1].text, "{\"a\":1}\n{\"torn\n{\"b\":2}\n");
        assert!(append_log(&root, "x", "y").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn files() {
        let root = temp("files");
        assert_eq!(read_file(&root, "history.json").unwrap(), None);
        write_file(&root, "snapshots/month-2026-10.json", "{}").unwrap();
        write_file(&root, "snapshots/year-2026.json", "[]").unwrap();
        assert_eq!(read_file(&root, "snapshots/year-2026.json").unwrap().as_deref(), Some("[]"));
        assert_eq!(list_dir(&root, "snapshots").unwrap(), ["snapshots/month-2026-10.json", "snapshots/year-2026.json"]);
        assert!(write_file(&root, "../evil.json", "x").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
