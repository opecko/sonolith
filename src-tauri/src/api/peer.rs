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

/// `SO_PEERPIDFD` (Linux 6.5): a pidfd of the process that connected. The libc crate lacks the constant. 77 on the
/// architectures listed; others (mips, sparc, powerpc, ...) number socket options differently, so they take the
/// fallback rather than risk asking for another option.
#[cfg(all(target_os = "linux", any(target_arch = "x86", target_arch = "x86_64", target_arch = "arm", target_arch = "aarch64", target_arch = "riscv64")))]
const SO_PEERPIDFD: libc::c_int = 77;

/// A pidfd for the peer of a connected Unix socket, or None (kernel older than 6.5, or an architecture without the
/// constant): the caller then trusts the pid from the socket credentials, which can be reused after the peer exits.
#[cfg(target_os = "linux")]
pub fn peer_pidfd(socket: std::os::fd::RawFd) -> Option<std::os::fd::OwnedFd> {
    #[cfg(any(target_arch = "x86", target_arch = "x86_64", target_arch = "arm", target_arch = "aarch64", target_arch = "riscv64"))]
    {
        use std::os::fd::FromRawFd;
        let mut fd: libc::c_int = -1;
        let mut len = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
        // SAFETY: an int-sized out parameter and its length; the new fd, if any, is ours alone.
        let r = unsafe { libc::getsockopt(socket, libc::SOL_SOCKET, SO_PEERPIDFD, &mut fd as *mut _ as *mut libc::c_void, &mut len) };
        return (r == 0 && fd >= 0).then(|| unsafe { std::os::fd::OwnedFd::from_raw_fd(fd) });
    }
    #[allow(unreachable_code)]
    {
        let _ = socket;
        None
    }
}

/// The pid a pidfd refers to, in our pid namespace; None once the process is gone (the kernel then reports -1) or
/// when it is outside our namespace (0).
#[cfg(target_os = "linux")]
pub fn pidfd_pid(pidfd: &std::os::fd::OwnedFd) -> Option<i32> {
    use std::os::fd::AsRawFd;
    let info = std::fs::read_to_string(format!("/proc/self/fdinfo/{}", pidfd.as_raw_fd())).ok()?;
    parse_fdinfo_pid(&info)
}

#[cfg(any(target_os = "linux", test))]
fn parse_fdinfo_pid(info: &str) -> Option<i32> {
    let pid: i32 = info.lines().find_map(|l| l.strip_prefix("Pid:"))?.trim().parse().ok()?;
    (pid > 0).then_some(pid)
}

/// What the accept loop learns about a connection before it looks at the process: credentials and, on a kernel that
/// has it, a pidfd that keeps pointing at the same process even if its pid is reused.
#[cfg(target_os = "linux")]
pub struct UnixPeer {
    pub cred: Option<tokio::net::unix::UCred>,
    pub pidfd: Option<std::os::fd::OwnedFd>,
}

#[cfg(target_os = "linux")]
impl UnixPeer {
    pub fn of(stream: &tokio::net::UnixStream) -> UnixPeer {
        UnixPeer { cred: stream.peer_cred().ok(), pidfd: peer_pidfd(std::os::fd::AsRawFd::as_raw_fd(stream)) }
    }
}

/// The connecting process of a Unix socket, after checking it runs as our user. Blocking.
///
/// With a pidfd the pid comes from it, and after /proc has been read the pidfd must still refer to that pid: the
/// process cannot have exited and its pid been given to another program in between. Without one (older kernels) the
/// pid from the socket credentials is used, which has that race.
#[cfg(target_os = "linux")]
pub fn unix_peer(peer: UnixPeer) -> Result<ProcessInfo, PeerError> {
    use std::os::unix::fs::MetadataExt;
    let cred = peer.cred.ok_or(PeerError::Unknown)?;
    let me = std::fs::metadata("/proc/self").map_err(|_| PeerError::Unknown)?.uid();
    if cred.uid() != me {
        return Err(PeerError::OtherUser);
    }
    let pid = match &peer.pidfd {
        Some(fd) => pidfd_pid(fd).ok_or(PeerError::Unknown)?,
        None => cred.pid().ok_or(PeerError::Unknown)?,
    };
    let info = linux_process(pid)?;
    if let Some(fd) = &peer.pidfd {
        if pidfd_pid(fd) != Some(pid) {
            return Err(PeerError::Unknown);
        }
    }
    Ok(info)
}

/// Whether a process that started at `created` can be the one that connected at `connected` (both Windows FILETIME,
/// 100 ns ticks): a process created after the connection only holds the pid of the client that left.
#[cfg(any(windows, test))]
pub fn started_before(created: u64, connected: u64) -> bool {
    created != 0 && created <= connected
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

    #[test]
    fn a_process_created_after_the_connection_is_not_the_client() {
        assert!(started_before(100, 200) && started_before(200, 200));
        assert!(!started_before(201, 200));
        assert!(!started_before(0, 200), "no creation time, no trust");
    }

    #[test]
    fn reads_the_pid_from_fdinfo() {
        assert_eq!(parse_fdinfo_pid("pos:\t0\nflags:\t02000002\nmnt_id:\t16\nPid:\t4242\nNSpid:\t4242\n"), Some(4242));
        assert_eq!(parse_fdinfo_pid("Pid:\t-1\n"), None, "the process is gone");
        assert_eq!(parse_fdinfo_pid("Pid:\t0\n"), None, "outside our pid namespace");
        assert_eq!(parse_fdinfo_pid("flags:\t0\n"), None);
    }

    #[cfg(target_os = "linux")]
    fn pidfd_open(pid: i32) -> Option<std::os::fd::OwnedFd> {
        use std::os::fd::FromRawFd;
        // SAFETY: pidfd_open takes a pid and flags and returns a new fd or -1.
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0) };
        (fd >= 0).then(|| unsafe { std::os::fd::OwnedFd::from_raw_fd(fd as i32) })
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_pidfd_notices_that_its_process_is_gone() {
        let mut child = std::process::Command::new("sleep").arg("30").spawn().unwrap();
        let Some(fd) = pidfd_open(child.id() as i32) else { return }; // kernel without pidfd_open
        assert_eq!(pidfd_pid(&fd), Some(child.id() as i32));
        child.kill().unwrap();
        child.wait().unwrap(); // reaped: the pid is free to be reused
        assert_eq!(pidfd_pid(&fd), None);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn the_peer_of_a_socket_is_this_process_by_pidfd_and_by_credentials() {
        let (a, _b) = tokio::net::UnixStream::pair().unwrap();
        let peer = UnixPeer::of(&a);
        assert_eq!(peer.cred.unwrap().pid(), Some(std::process::id() as i32));
        match &peer.pidfd {
            Some(fd) => assert_eq!(pidfd_pid(fd), Some(std::process::id() as i32)),
            None => eprintln!("no SO_PEERPIDFD here (kernel older than 6.5): fallback only"),
        }
        let me = unix_peer(peer).unwrap();
        assert!(me.exe.starts_with('/'));
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn without_a_pidfd_the_credentials_pid_is_used() {
        let (a, _b) = tokio::net::UnixStream::pair().unwrap();
        let older_kernel = UnixPeer { cred: a.peer_cred().ok(), pidfd: None };
        assert!(unix_peer(older_kernel).unwrap().exe.starts_with('/'));
        assert!(matches!(unix_peer(UnixPeer { cred: None, pidfd: None }), Err(PeerError::Unknown)));
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
