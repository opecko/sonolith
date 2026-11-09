//! Pairing defenses: the secret, its constant-time check, and a limit on wrong guesses. Pure.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;

/// Wrong pairing attempts one address may make in `WINDOW_MS` before it has to wait.
const PER_ADDRESS: usize = 5;
/// Pairing attempts from everyone together in `WINDOW_MS`.
const OVERALL: usize = 30;
const WINDOW_MS: u64 = 10 * 60_000;
/// Addresses remembered at most; the oldest is forgotten first.
const MAX_ADDRESSES: usize = 256;

/// A new pairing secret: 256 random bits, base64url.
pub fn new_secret() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("OS random source");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Equal in constant time for equal lengths, so a guess learns nothing from timing about where it went wrong.
pub fn same_secret(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[derive(Default)]
pub struct PairLimit {
    failures: HashMap<IpAddr, VecDeque<u64>>,
    attempts: VecDeque<u64>,
}

impl PairLimit {
    /// Whether `ip` may try now; Err(ms to wait) when not. Counts the attempt when it may.
    pub fn admit(&mut self, ip: IpAddr, now: u64) -> Result<(), u64> {
        let since = now.saturating_sub(WINDOW_MS);
        self.attempts.retain(|&t| t > since);
        if let Some(f) = self.failures.get_mut(&ip) {
            f.retain(|&t| t > since);
            if f.len() >= PER_ADDRESS {
                return Err(f[0] + WINDOW_MS - now);
            }
        }
        if self.attempts.len() >= OVERALL {
            return Err(self.attempts[0] + WINDOW_MS - now);
        }
        self.attempts.push_back(now);
        Ok(())
    }

    pub fn failed(&mut self, ip: IpAddr, now: u64) {
        if !self.failures.contains_key(&ip) && self.failures.len() >= MAX_ADDRESSES {
            let oldest = self.failures.iter().min_by_key(|(_, f)| f.back().copied().unwrap_or(0)).map(|(k, _)| *k);
            if let Some(k) = oldest {
                self.failures.remove(&k);
            }
        }
        self.failures.entry(ip).or_default().push_back(now);
    }

    /// A new link starts over.
    pub fn reset(&mut self) {
        *self = PairLimit::default();
    }
}

/// A name for a newly paired phone, from its browser's User-Agent (only a few fixed words, never the raw text).
pub fn device_name(user_agent: &str) -> &'static str {
    let ua = user_agent.to_ascii_lowercase();
    if ua.contains("ipad") {
        "iPad"
    } else if ua.contains("iphone") {
        "iPhone"
    } else if ua.contains("android") {
        if ua.contains("mobile") { "Android phone" } else { "Android tablet" }
    } else {
        "Phone or browser"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_are_long_and_compared_whole() {
        let s = new_secret();
        assert_eq!(s.len(), 43);
        assert_ne!(s, new_secret());
        assert!(same_secret(&s, &s.clone()));
        assert!(!same_secret(&s, &s[..42]));
        assert!(!same_secret("abc", "abd"));
    }

    #[test]
    fn wrong_guesses_make_an_address_wait() {
        let mut l = PairLimit::default();
        let a: IpAddr = "192.168.1.20".parse().unwrap();
        let b: IpAddr = "192.168.1.21".parse().unwrap();
        for i in 0..PER_ADDRESS as u64 {
            assert!(l.admit(a, 1000 + i).is_ok());
            l.failed(a, 1000 + i);
        }
        assert_eq!(l.admit(a, 2000), Err(1000 + WINDOW_MS - 2000));
        // Another address is not held up, and the first may try again once the window passes.
        assert!(l.admit(b, 2000).is_ok());
        assert!(l.admit(a, 1000 + WINDOW_MS + 5).is_ok());
    }

    #[test]
    fn everyone_together_is_capped_too() {
        let mut l = PairLimit::default();
        for i in 0..OVERALL as u8 {
            assert!(l.admit(IpAddr::from([10, 0, 0, i]), 10).is_ok());
        }
        assert!(l.admit(IpAddr::from([10, 0, 1, 1]), 20).is_err());
        l.reset();
        assert!(l.admit(IpAddr::from([10, 0, 1, 1]), 20).is_ok());
    }

    #[test]
    fn remembers_a_bounded_number_of_addresses() {
        let mut l = PairLimit::default();
        for i in 0..(MAX_ADDRESSES as u32 + 10) {
            l.failed(IpAddr::from(i.to_be_bytes()), i as u64);
        }
        assert_eq!(l.failures.len(), MAX_ADDRESSES);
    }

    #[test]
    fn names_devices_by_platform() {
        assert_eq!(device_name("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari"), "Android phone");
        assert_eq!(device_name("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), "iPhone");
        assert_eq!(device_name("<script>"), "Phone or browser");
    }
}
