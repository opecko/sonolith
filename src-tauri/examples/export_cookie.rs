//! Dev helper: copies the keyring cookie into ../.env.local (gitignored) for scripts/dbg.ts. Never prints it.
use std::{fs, io::Write, os::unix::fs::OpenOptionsExt};

fn main() {
    let cookie = keyring::Entry::new("sonolith", "ytmusic-cookie")
        .and_then(|e| e.get_secret().map(|b| String::from_utf8_lossy(&b).into_owned()))
        .unwrap_or_else(|e| panic!("keyring read failed: {e}"));
    let mut f = fs::OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open("../.env.local").unwrap();
    writeln!(f, "YTM_COOKIE='{cookie}'").unwrap();
    println!("wrote .env.local ({} cookies)", cookie.split(';').count());
}
