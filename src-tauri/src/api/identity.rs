//! App identity: which program is calling, normalized so ordinary updates keep it (api/SPEC.md section 6.6).
//!
//! Pure: the process facts come in as `ProcessInfo` and file checks go through `Fs`, so the same code runs the
//! fixture cases of both platforms (api/tests/identity-cases.json) on any machine.

use serde::{Deserialize, Serialize};

/// What the operating system reports about the calling process.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    /// The verified executable path.
    pub exe: String,
    #[serde(default)]
    pub argv: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    /// `APPIMAGE` from the process environment.
    #[serde(default)]
    pub appimage: Option<String>,
    /// The Flatpak app id when the process runs in a Flatpak sandbox.
    #[serde(default)]
    pub flatpak_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Executable,
    Interpreter,
    Appimage,
    Flatpak,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIdentity {
    pub kind: Kind,
    pub key: String,
    pub executable: String,
    pub interpreter: Option<String>,
    pub script: Option<String>,
    pub app_image: Option<String>,
    pub flatpak_id: Option<String>,
}

/// File system access, so tests can describe which files exist.
pub trait Fs {
    fn is_file(&self, path: &str) -> bool;
    /// The path with symbolic links resolved, or the path itself when that fails.
    fn canonical(&self, path: &str) -> String;
}

/// The real file system.
pub struct RealFs;

impl Fs for RealFs {
    fn is_file(&self, path: &str) -> bool {
        std::path::Path::new(path).is_file()
    }
    fn canonical(&self, path: &str) -> String {
        match std::fs::canonicalize(path) {
            Ok(p) => {
                let s = p.to_string_lossy().into_owned();
                // Windows returns verbatim paths (\\?\C:\…); keep the ordinary form.
                s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s)
            }
            Err(_) => path.to_string(),
        }
    }
}

pub fn derive(p: &ProcessInfo, windows: bool, fs: &dyn Fs) -> AppIdentity {
    let mut id = AppIdentity {
        kind: Kind::Executable,
        key: String::new(),
        executable: p.exe.clone(),
        interpreter: None,
        script: None,
        app_image: None,
        flatpak_id: None,
    };
    let sep = if windows { '\\' } else { '/' };

    if let Some(fid) = p.flatpak_id.as_deref().filter(|f| !f.is_empty()) {
        id.kind = Kind::Flatpak;
        id.flatpak_id = Some(fid.to_string());
        id.key = format!("flatpak:{fid}");
        return id;
    }

    if !windows && p.exe.split('/').any(|s| s.starts_with(".mount_")) {
        if let Some(img) = p.appimage.as_deref().filter(|a| a.starts_with('/') && fs.is_file(a)) {
            let img = fs.canonical(img);
            id.kind = Kind::Appimage;
            id.key = format!("appimage:{}", appimage_key(&img));
            id.app_image = Some(img);
            return id;
        }
    }

    if let Some((family, rules)) = interpreter(&basename(&p.exe, sep), windows) {
        id.kind = Kind::Interpreter;
        id.script = script(&p.argv, rules, p.cwd.as_deref(), windows, fs);
        let script_key = match &id.script {
            Some(s) if s.starts_with("module:") => s.clone(),
            Some(s) => normalize_path(s, windows),
            None => "-".into(),
        };
        id.key = finish_key(format!("interp:{family}:{script_key}"), windows);
        id.interpreter = Some(family);
        return id;
    }

    id.key = finish_key(format!("exe:{}", normalize_path(&p.exe, windows)), windows);
    id
}

fn finish_key(key: String, windows: bool) -> String {
    if windows {
        key.to_lowercase()
    } else {
        key
    }
}

fn basename(path: &str, sep: char) -> String {
    path.rsplit([sep, '/']).next().unwrap_or(path).to_string()
}

// ---------------------------------------------------------------- interpreters

/// How an interpreter's command line names its script.
struct Rules {
    /// Options followed by a separate value.
    value: &'static [&'static str],
    /// Options after which there is no script (inline code, stdin).
    stop: &'static [&'static str],
    /// The option that names a module instead of a script (`python -m`).
    module: Option<&'static str>,
    /// Options followed by the script path (`pwsh -File`).
    file: &'static [&'static str],
    /// A subcommand skipped before the script (`bun run`).
    subcommands: &'static [&'static str],
    /// Whether the first bare argument is the script (false for Windows PowerShell 5.1: it is a command).
    positional: bool,
    /// Options are case-insensitive.
    ci: bool,
}

const PYTHON: Rules = Rules {
    value: &["-W", "-X", "--check-hash-based-pycs"],
    stop: &["-c", "-"],
    module: Some("-m"),
    file: &[],
    subcommands: &[],
    positional: true,
    ci: false,
};
const NODE: Rules = Rules {
    value: &["-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions", "--title", "--env-file", "--input-type"],
    stop: &["-e", "--eval", "-p", "--print", "-"],
    module: None,
    file: &[],
    subcommands: &[],
    positional: true,
    ci: false,
};
const BUN: Rules = Rules {
    value: &["--cwd", "--config", "-c", "--preload", "-r", "--env-file"],
    stop: &["-e", "--eval", "-p", "--print"],
    module: None,
    file: &[],
    subcommands: &["run"],
    positional: true,
    ci: false,
};
const DENO: Rules = Rules {
    value: &["-c", "--config", "--import-map", "--lock", "--cert", "-L", "--log-level", "--location"],
    stop: &["-"],
    module: None,
    file: &[],
    subcommands: &["run"],
    positional: true,
    ci: false,
};
const RUBY: Rules = Rules {
    value: &["-r", "-I", "-C", "-E", "-F"],
    stop: &["-e", "-"],
    module: None,
    file: &[],
    subcommands: &[],
    positional: true,
    ci: false,
};
const PERL: Rules = Rules {
    value: &["-I", "-M", "-m"],
    stop: &["-e", "-E", "-"],
    module: None,
    file: &[],
    subcommands: &[],
    positional: true,
    ci: false,
};
const SHELL: Rules = Rules {
    value: &["-o", "-O", "+o", "+O", "--rcfile", "--init-file"],
    stop: &["-c", "-s", "-"],
    module: None,
    file: &[],
    subcommands: &[],
    positional: true,
    ci: false,
};
const FISH: Rules = Rules {
    value: &["-C", "--init-command", "--features", "-d", "--debug", "-o", "--debug-output", "--profile"],
    stop: &["-c", "--command"],
    module: None,
    file: &[],
    subcommands: &[],
    positional: true,
    ci: false,
};
const PWSH_VALUE: &[&str] = &[
    "-executionpolicy", "-ex", "-ep", "-workingdirectory", "-wd", "-configurationname", "-config", "-windowstyle", "-w",
    "-outputformat", "-o", "-of", "-inputformat", "-inp", "-if", "-settingsfile", "-settings", "-custompipename",
    "-psconsolefile", "-version", "-v",
];
const PWSH_STOP: &[&str] = &["-command", "-c", "-encodedcommand", "-e", "-ec", "-commandwithargs", "-cwa"];
const PWSH: Rules = Rules { value: PWSH_VALUE, stop: PWSH_STOP, module: None, file: &["-file", "-f"], subcommands: &[], positional: true, ci: true };
const POWERSHELL: Rules = Rules { value: PWSH_VALUE, stop: PWSH_STOP, module: None, file: &["-file", "-f"], subcommands: &[], positional: false, ci: true };

/// The interpreter family (`python3.13` → `python3`) and its command-line rules, or None for other programs.
fn interpreter(name: &str, windows: bool) -> Option<(String, &'static Rules)> {
    let lower = name.to_lowercase();
    let name = if windows { lower.strip_suffix(".exe").unwrap_or(&lower) } else { name };
    const BASES: &[(&str, &str, &Rules)] = &[
        ("pythonw", "python", &PYTHON),
        ("python", "python", &PYTHON),
        ("nodejs", "node", &NODE),
        ("node", "node", &NODE),
        ("bun", "bun", &BUN),
        ("deno", "deno", &DENO),
        ("ruby", "ruby", &RUBY),
        ("perl", "perl", &PERL),
        ("bash", "bash", &SHELL),
        ("dash", "dash", &SHELL),
        ("zsh", "zsh", &SHELL),
        ("sh", "sh", &SHELL),
        ("fish", "fish", &FISH),
        ("pwsh", "pwsh", &PWSH),
        ("powershell", "powershell", &POWERSHELL),
    ];
    for (base, family, rules) in BASES {
        let Some(rest) = name.strip_prefix(base) else { continue };
        let is_version = rest.is_empty()
            || (rest.starts_with(|c: char| c.is_ascii_digit()) && rest.chars().all(|c| c.is_ascii_digit() || c == '.'));
        if is_version {
            let major = rest.split('.').next().unwrap_or("");
            return Some((format!("{family}{major}"), rules));
        }
    }
    None
}

fn script(argv: &[String], r: &Rules, cwd: Option<&str>, windows: bool, fs: &dyn Fs) -> Option<String> {
    let eq = |a: &str, b: &str| if r.ci { a.eq_ignore_ascii_case(b) } else { a == b };
    let has = |list: &[&str], t: &str| list.iter().any(|o| eq(o, t));
    let mut i = 1;
    let mut positional_seen = false;
    let candidate = loop {
        let t = argv.get(i)?.as_str();
        if t == "--" {
            break argv.get(i + 1)?.clone();
        }
        if t.starts_with('-') && t.len() > 1 || t == "-" {
            if let Some(m) = r.module {
                if t == m {
                    return argv.get(i + 1).map(|m| format!("module:{m}"));
                }
                if let Some(attached) = t.strip_prefix(m).filter(|a| !a.is_empty() && !a.starts_with('-')) {
                    return Some(format!("module:{attached}"));
                }
            }
            if has(r.stop, t) {
                return None;
            }
            if has(r.file, t) {
                break argv.get(i + 1)?.clone();
            }
            i += if has(r.value, t) { 2 } else { 1 };
            continue;
        }
        if !positional_seen && has(r.subcommands, t) {
            positional_seen = true;
            i += 1;
            continue;
        }
        if !r.positional {
            return None;
        }
        break t.to_string();
    };
    let abs = absolute(&candidate, cwd, windows)?;
    fs.is_file(&abs).then(|| fs.canonical(&abs))
}

/// Makes a path absolute against the working directory and removes `.` and `..` segments.
fn absolute(path: &str, cwd: Option<&str>, windows: bool) -> Option<String> {
    let sep = if windows { '\\' } else { '/' };
    let path = if windows { path.replace('/', "\\") } else { path.to_string() };
    let is_abs = if windows {
        path.starts_with("\\\\") || path.as_bytes().get(1) == Some(&b':') && path.as_bytes().get(2) == Some(&b'\\')
    } else {
        path.starts_with('/')
    };
    let joined = if is_abs { path } else { format!("{}{sep}{path}", cwd?.trim_end_matches(sep)) };
    let mut out: Vec<&str> = Vec::new();
    for (n, seg) in joined.split(sep).enumerate() {
        match seg {
            "." => {}
            "" if n > 0 => {}
            ".." => {
                if out.len() > 1 {
                    out.pop();
                }
            }
            s => out.push(s),
        }
    }
    let s = out.join(&sep.to_string());
    Some(if !windows && s.is_empty() { "/".into() } else { s })
}

// ---------------------------------------------------------------- version normalization

fn is_version(s: &str) -> bool {
    let s = s.strip_prefix(['v', 'V']).unwrap_or(s);
    !s.is_empty() && s.starts_with(|c: char| c.is_ascii_digit()) && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_'))
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Digits separated by dots, at least two parts (`1.2`, `1.2.3.0`).
fn dotted(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() >= 2 && parts.iter().all(|p| all_digits(p))
}

/// Replaces version segments of a path with `*` (SPEC.md section 6.6).
pub fn normalize_path(path: &str, windows: bool) -> String {
    let sep = if windows { '\\' } else { '/' };
    let mut segs: Vec<String> = path.split(sep).map(str::to_string).collect();
    let low: Vec<String> = segs.iter().map(|s| s.to_lowercase()).collect();
    let at = |i: usize, back: usize| -> &str { if i >= back { low[i - back].as_str() } else { "" } };
    for i in 0..segs.len() {
        let s = low[i].as_str();
        let star = (at(i, 3) == ".nvm" && at(i, 2) == "versions" && at(i, 1) == "node")
            || (at(i, 1) == "nvm" && s.starts_with('v') && is_version(s))
            || (at(i, 2) == ".pyenv" && at(i, 1) == "versions")
            || (matches!(at(i, 3), ".asdf" | "mise" | ".mise") && at(i, 2) == "installs")
            || (at(i, 4) == ".volta" && at(i, 3) == "tools" && at(i, 2) == "image")
            || (at(i, 2) == "fnm" && at(i, 1) == "node-versions")
            || (at(i, 2) == "cellar" && is_version(s))
            || (!windows && i == 3 && at(i, 2) == "snap" && at(i, 3).is_empty() && all_digits(s));
        if star && i > 0 {
            segs[i] = "*".into();
            continue;
        }
        // lib/python3.13 → lib/python3.*
        if at(i, 1) == "lib" {
            if let Some(v) = s.strip_prefix("python").filter(|v| dotted(v)) {
                segs[i] = format!("python{}.*", v.split('.').next().unwrap_or(""));
                continue;
            }
        }
        if windows {
            // Python313, Python313-32 → Python3*, Python3*-32
            if let Some(rest) = s.strip_prefix("python") {
                let (digits, suffix) = rest.split_at(rest.find('-').unwrap_or(rest.len()));
                if digits.len() >= 2 && all_digits(digits) && matches!(suffix, "" | "-32" | "-arm64") {
                    segs[i] = format!("{}{}*{}", &segs[i][..6], &digits[..1], suffix);
                    continue;
                }
            }
            // app-1.2.3 → app-*
            if s.strip_prefix("app-").is_some_and(dotted) {
                segs[i] = format!("{}*", &segs[i][..4]);
                continue;
            }
            // WindowsApps\Name_1.2.3.0_x64__id → Name_*_x64__id
            if at(i, 1) == "windowsapps" {
                let parts: Vec<&str> = segs[i].splitn(3, '_').collect();
                if parts.len() == 3 && dotted(parts[1]) {
                    segs[i] = format!("{}_*_{}", parts[0], parts[2]);
                    continue;
                }
            }
        }
    }
    segs.join(&sep.to_string())
}

/// An AppImage path with version numbers in its file name replaced by `*`.
fn appimage_key(path: &str) -> String {
    let (dir, file) = path.rsplit_once('/').unwrap_or(("", path));
    let mut out = String::new();
    let chars: Vec<char> = file.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.' && chars.get(i + 1).is_some_and(|c| c.is_ascii_digit())) {
                i += 1;
            }
            let run: String = chars[start..i].iter().collect();
            out.push_str(if run.contains('.') { "*" } else { &run });
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    format!("{dir}/{out}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[derive(Deserialize)]
    struct Cases {
        cases: Vec<Case>,
    }
    #[derive(Deserialize)]
    struct Case {
        name: String,
        platform: String,
        process: FixtureProcess,
        identity: AppIdentity,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FixtureProcess {
        exe: String,
        argv: Vec<String>,
        cwd: String,
        env: std::collections::HashMap<String, String>,
        flatpak_id: Option<String>,
        files: Vec<String>,
    }

    struct FakeFs(HashSet<String>);
    impl Fs for FakeFs {
        fn is_file(&self, path: &str) -> bool {
            self.0.contains(path)
        }
        fn canonical(&self, path: &str) -> String {
            path.to_string()
        }
    }

    #[test]
    fn spec_fixture_cases() {
        let cases: Cases = serde_json::from_str(include_str!("../../../api/tests/identity-cases.json")).unwrap();
        assert!(cases.cases.len() >= 30);
        for c in cases.cases {
            let p = ProcessInfo {
                exe: c.process.exe,
                argv: c.process.argv,
                cwd: Some(c.process.cwd),
                appimage: c.process.env.get("APPIMAGE").cloned(),
                flatpak_id: c.process.flatpak_id,
            };
            let fs = FakeFs(c.process.files.into_iter().collect());
            let got = derive(&p, c.platform == "windows", &fs);
            assert_eq!(got, c.identity, "case {:?}", c.name);
        }
    }

    #[test]
    fn non_interpreters_that_look_like_one() {
        for name in ["shellcheck", "python3-config", "nodemon", "bashtop", "sha256sum"] {
            assert!(interpreter(name, false).is_none(), "{name}");
        }
        assert_eq!(interpreter("PYTHON.EXE", true).unwrap().0, "python");
        assert_eq!(interpreter("perl5.38", false).unwrap().0, "perl5");
    }

    #[test]
    fn missing_values_never_panic() {
        let fs = FakeFs(HashSet::new());
        for argv in [vec!["python3", "-m"], vec!["node", "--require"], vec!["pwsh", "-File"], vec!["zsh", "--"], vec!["python3"]] {
            let p = ProcessInfo { exe: "/usr/bin/x".into(), argv: argv.iter().map(|s| s.to_string()).collect(), cwd: None, ..Default::default() };
            let id = derive(&ProcessInfo { exe: format!("/usr/bin/{}", argv[0]), ..p }, false, &fs);
            assert_eq!(id.kind, Kind::Interpreter);
        }
    }

    #[test]
    fn relative_script_without_cwd_has_no_script() {
        let fs = FakeFs(["/x/a.py".to_string()].into_iter().collect());
        let p = ProcessInfo { exe: "/usr/bin/python3".into(), argv: vec!["python3".into(), "a.py".into()], ..Default::default() };
        assert_eq!(derive(&p, false, &fs).key, "interp:python3:-");
    }
}
