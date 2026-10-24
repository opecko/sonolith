//! Who is on the other end of a connection: the process facts `identity::derive` needs.

#[cfg(target_os = "linux")]
use super::identity::ProcessInfo;

#[derive(Debug)]
pub enum PeerError {
    /// The process belongs to another user (should not happen: the endpoint is private).
    #[cfg_attr(windows, allow(dead_code))]
    OtherUser,
    /// The OS did not tell us enough to identify the process.
    Unknown,
}

#[cfg(target_os = "linux")]
pub fn linux_process(pid: i32) -> Result<ProcessInfo, PeerError> {
    use std::fs;
    let proc = format!("/proc/{pid}");
    let exe = fs::read_link(format!("{proc}/exe")).map_err(|_| PeerError::Unknown)?;
    let mut exe = exe.to_string_lossy().into_owned();
    // A binary replaced while running reads as "/path (deleted)"; it is still the same program.
    if let Some(s) = exe.strip_suffix(" (deleted)") {
        exe = s.to_string();
    }
    let argv = fs::read(format!("{proc}/cmdline"))
        .map(|b| b.split(|&c| c == 0).filter(|s| !s.is_empty()).map(|s| String::from_utf8_lossy(s).into_owned()).collect())
        .unwrap_or_default();
    let cwd = fs::read_link(format!("{proc}/cwd")).ok().map(|p| p.to_string_lossy().into_owned());
    let appimage = fs::read(format!("{proc}/environ")).ok().and_then(|b| {
        b.split(|&c| c == 0)
            .find_map(|kv| kv.strip_prefix(b"APPIMAGE=").map(|v| String::from_utf8_lossy(v).into_owned()))
    });
    // Flatpak writes this file read-only into every sandbox; the sandboxed app cannot change it.
    let flatpak_id = fs::read_to_string(format!("{proc}/root/.flatpak-info")).ok().and_then(|s| flatpak_app_id(&s));
    Ok(ProcessInfo { exe, argv, cwd, appimage, flatpak_id })
}

#[cfg(any(target_os = "linux", test))]
/// `name=` in the `[Application]` group of a `.flatpak-info` file.
pub fn flatpak_app_id(info: &str) -> Option<String> {
    let mut in_app = false;
    for line in info.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_app = line == "[Application]";
        } else if in_app {
            if let Some(v) = line.strip_prefix("name=") {
                return Some(v.trim().to_string()).filter(|v| !v.is_empty());
            }
        }
    }
    None
}

/// The connecting process of a Unix socket (from its credentials), after checking it runs as our user. Blocking.
#[cfg(target_os = "linux")]
pub fn unix_peer(cred: Option<tokio::net::unix::UCred>) -> Result<ProcessInfo, PeerError> {
    use std::os::unix::fs::MetadataExt;
    let cred = cred.ok_or(PeerError::Unknown)?;
    let me = std::fs::metadata("/proc/self").map_err(|_| PeerError::Unknown)?.uid();
    if cred.uid() != me {
        return Err(PeerError::OtherUser);
    }
    linux_process(cred.pid().ok_or(PeerError::Unknown)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_flatpak_info() {
        let info = "[Application]\nname=com.example.MyBar\nruntime=runtime/org.freedesktop.Platform\n\n[Instance]\nname=nope\n";
        assert_eq!(flatpak_app_id(info).as_deref(), Some("com.example.MyBar"));
        assert_eq!(flatpak_app_id("[Instance]\nname=x\n"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reads_own_process() {
        let me = linux_process(std::process::id() as i32).unwrap();
        assert!(me.exe.starts_with('/'));
        assert!(!me.argv.is_empty());
        assert!(me.cwd.is_some());
    }
}
