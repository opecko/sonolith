//! Windows: the named pipe (private to the current user) and the pipe client's process facts.

use super::identity::ProcessInfo;
use super::peer::PeerError;
use std::ffi::c_void;
use std::os::windows::io::AsRawHandle;
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, FILETIME, HANDLE};
use windows_sys::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW};
use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER};
use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId;
use windows_sys::Win32::System::SystemInformation::GetSystemTimePreciseAsFileTime;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetProcessTimes, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_BASIC_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
};
use windows_sys::Wdk::System::Threading::NtQueryInformationProcess;
use windows_sys::Win32::UI::Shell::CommandLineToArgvW;

/// `sonolith-api-<user>`: the user name in lower case, characters outside `a-z0-9._-` replaced by `_`.
pub fn default_pipe_name() -> String {
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into()).to_lowercase();
    let user: String = user.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' }).collect();
    format!(r"\\.\pipe\sonolith-api-{user}")
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe fn from_wide(p: *const u16) -> String {
    let mut len = 0;
    while *p.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
}

/// The current user's SID as a string (S-1-5-21-…).
fn user_sid() -> std::io::Result<String> {
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let mut len = 0u32;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut len);
        let mut buf = vec![0u8; len as usize];
        let ok = GetTokenInformation(token, TokenUser, buf.as_mut_ptr() as *mut c_void, len, &mut len);
        CloseHandle(token);
        if ok == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        let mut s: *mut u16 = std::ptr::null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut s) == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let sid = from_wide(s);
        LocalFree(s as *mut c_void);
        Ok(sid)
    }
}

/// Security attributes that allow only the current user (protected DACL, one ACE).
pub struct UserOnly {
    attrs: SECURITY_ATTRIBUTES,
}

unsafe impl Send for UserOnly {}
unsafe impl Sync for UserOnly {}

impl UserOnly {
    pub fn new() -> std::io::Result<UserOnly> {
        let sddl = wide(&format!("D:P(A;;GA;;;{})", user_sid()?));
        let mut sd: *mut c_void = std::ptr::null_mut();
        if unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), 1, &mut sd, std::ptr::null_mut()) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(UserOnly {
            attrs: SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: sd,
                bInheritHandle: 0,
            },
        })
    }

    /// Creates one pipe instance. `first` fails if anyone else already holds the name.
    pub fn create(&self, name: &str, first: bool) -> std::io::Result<NamedPipeServer> {
        let mut attrs = self.attrs;
        unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(name, &mut attrs as *mut _ as *mut c_void)
        }
    }
}

impl Drop for UserOnly {
    fn drop(&mut self) {
        unsafe { LocalFree(self.attrs.lpSecurityDescriptor) };
    }
}

/// The pipe client's process id. The pipe's ACL already limits clients to the current user.
pub fn pipe_client_pid(pipe: &NamedPipeServer) -> Option<u32> {
    let mut pid = 0u32;
    let ok = unsafe { GetNamedPipeClientProcessId(pipe.as_raw_handle() as HANDLE, &mut pid) } != 0;
    (ok && pid != 0).then_some(pid)
}

fn ticks(t: FILETIME) -> u64 {
    (u64::from(t.dwHighDateTime) << 32) | u64::from(t.dwLowDateTime)
}

/// Now, as FILETIME ticks (100 ns). Read right after a client connects: a process created later can't be that client.
pub fn now_filetime() -> u64 {
    let mut t = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    unsafe { GetSystemTimePreciseAsFileTime(&mut t) };
    ticks(t)
}

/// When the process behind a handle was created (FILETIME ticks), 0 if the system won't say.
unsafe fn creation_time(h: HANDLE) -> u64 {
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    if GetProcessTimes(h, &mut created, &mut exited, &mut kernel, &mut user) == 0 {
        return 0;
    }
    ticks(created)
}

/// A process's facts (image path, command line, working directory). Blocking. `connected_at` is `now_filetime()` from
/// when the client connected: the pid comes from the pipe, and a pid can be reused once its process exits, so the
/// process behind it must have existed when the client connected, or it is not the client.
pub fn process(pid: u32, connected_at: u64) -> Result<ProcessInfo, PeerError> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
        let h = if h.is_null() { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) } else { h };
        if h.is_null() {
            return Err(PeerError::Unknown);
        }
        // The handle keeps pointing at this process object, so the check holds for everything read below.
        if !super::peer::started_before(creation_time(h), connected_at) {
            CloseHandle(h);
            return Err(PeerError::Unknown);
        }
        let mut buf = vec![0u16; 32768];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
        let exe = String::from_utf16_lossy(&buf[..len as usize]);
        let (cmdline, cwd) = read_params(h).unwrap_or((None, None));
        CloseHandle(h);
        if ok == 0 {
            return Err(PeerError::Unknown);
        }
        let argv = cmdline.map(|c| split_command_line(&c)).unwrap_or_default();
        let cwd = cwd.map(|c| if c.len() > 3 { c.trim_end_matches('\\').to_string() } else { c });
        Ok(ProcessInfo { exe, argv, cwd, appimage: None, flatpak_id: None })
    }
}

/// Reads a UNICODE_STRING { Length: u16, MaximumLength: u16, Buffer: u64 } at `addr` in the other process.
unsafe fn read_unicode(h: HANDLE, addr: usize) -> Option<String> {
    let mut header = [0u8; 16];
    read(h, addr, &mut header)?;
    let len = u16::from_le_bytes([header[0], header[1]]) as usize;
    let ptr = u64::from_le_bytes(header[8..16].try_into().ok()?) as usize;
    if len == 0 || ptr == 0 || len > 65534 {
        return None;
    }
    let mut bytes = vec![0u8; len];
    read(h, ptr, &mut bytes)?;
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    Some(String::from_utf16_lossy(&units))
}

unsafe fn read(h: HANDLE, addr: usize, out: &mut [u8]) -> Option<()> {
    let mut got = 0usize;
    (ReadProcessMemory(h, addr as *const c_void, out.as_mut_ptr() as *mut c_void, out.len(), &mut got) != 0 && got == out.len())
        .then_some(())
}

/// The command line and the working directory from the process parameters (64-bit layout).
unsafe fn read_params(h: HANDLE) -> Option<(Option<String>, Option<String>)> {
    let mut info: PROCESS_BASIC_INFORMATION = std::mem::zeroed();
    let mut ret = 0u32;
    if NtQueryInformationProcess(h, 0, &mut info as *mut _ as *mut c_void, std::mem::size_of::<PROCESS_BASIC_INFORMATION>() as u32, &mut ret) != 0 {
        return None;
    }
    let peb = info.PebBaseAddress as usize;
    let mut p = [0u8; 8];
    read(h, peb + 0x20, &mut p)?; // PEB.ProcessParameters
    let params = u64::from_le_bytes(p) as usize;
    // RTL_USER_PROCESS_PARAMETERS: CurrentDirectory.DosPath at 0x38, CommandLine at 0x70.
    Some((read_unicode(h, params + 0x70), read_unicode(h, params + 0x38)))
}

fn split_command_line(cmd: &str) -> Vec<String> {
    let w = wide(cmd);
    let mut n = 0i32;
    unsafe {
        let list = CommandLineToArgvW(w.as_ptr(), &mut n);
        if list.is_null() {
            return Vec::new();
        }
        let out = (0..n as usize).map(|i| from_wide(*list.add(i))).collect();
        LocalFree(list as *mut c_void);
        out
    }
}
