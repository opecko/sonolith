//! Which provider wins: pure, over results that arrive in any order. Quality first (word-synced, then line-synced,
//! then unsynced), the user's priority order within a tier. The best result so far is known as answers arrive.

use super::model::Lyrics;

#[derive(Clone, Debug)]
pub enum Outcome {
    Found { lyrics: Lyrics, source: Option<String> },
    NotFound,
    Error(String),
    Timeout,
}

impl Outcome {
    /// 3 word-synced, 2 line-synced, 1 unsynced, 0 nothing.
    pub fn tier(&self) -> u8 {
        match self {
            Outcome::Found { lyrics, .. } if lyrics.word_synced() => 3,
            Outcome::Found { lyrics, .. } if lyrics.synced => 2,
            Outcome::Found { .. } => 1,
            _ => 0,
        }
    }
    pub fn label(&self) -> &'static str {
        match self {
            Outcome::Found { .. } => match self.tier() {
                3 => "word-synced",
                2 => "line-synced",
                _ => "unsynced",
            },
            Outcome::NotFound => "none",
            Outcome::Error(_) => "error",
            Outcome::Timeout => "timeout",
        }
    }
}

/// What is known so far.
#[derive(Debug, PartialEq)]
pub struct Decision {
    /// The best result so far: the highest tier, the highest priority within it.
    pub best: Option<usize>,
    /// Nothing still running can beat it: stop waiting.
    pub settled: bool,
}

/// `results[i]` is the outcome of the provider with priority `i` (0 = highest), `None` while it runs. A pending
/// provider above the best one could still win its tier or a higher one; a pending provider below it only a higher
/// tier, so a word-synced best only waits for the providers above it.
pub fn decide(results: &[Option<&Outcome>]) -> Decision {
    let mut best: Option<(usize, u8)> = None;
    for (i, r) in results.iter().enumerate() {
        let tier = r.map_or(0, |o| o.tier());
        if tier > 0 && best.map_or(true, |(_, t)| tier > t) {
            best = Some((i, tier));
        }
    }
    let settled = match best {
        None => results.iter().all(Option::is_some),
        Some((i, tier)) => results[..i].iter().all(Option::is_some) && (tier == 3 || results[i + 1..].iter().all(Option::is_some)),
    };
    Decision { best: best.map(|(i, _)| i), settled }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics::model::{Line, Word};

    fn line(words: Vec<Word>) -> Line {
        Line { start: 0, end: None, text: "a".into(), words, background: vec![] }
    }
    fn word() -> Outcome {
        let w = Word { start: 0, end: 5, text: "a".into() };
        Outcome::Found { lyrics: Lyrics::synced(vec![line(vec![w])]).unwrap(), source: None }
    }
    fn synced() -> Outcome {
        Outcome::Found { lyrics: Lyrics::synced(vec![line(vec![])]).unwrap(), source: None }
    }
    fn plain() -> Outcome {
        Outcome::Found { lyrics: Lyrics::plain("a").unwrap(), source: None }
    }
    fn d(best: Option<usize>, settled: bool) -> Decision {
        Decision { best, settled }
    }

    #[test]
    fn tiers() {
        assert_eq!((word().tier(), synced().tier(), plain().tier(), Outcome::NotFound.tier()), (3, 2, 1, 0));
    }

    #[test]
    fn word_synced_beats_a_higher_priority_line_synced() {
        let (w, s) = (word(), synced());
        assert_eq!(decide(&[Some(&s), Some(&w)]), d(Some(1), true));
    }

    #[test]
    fn priority_decides_within_a_tier() {
        let (a, b) = (word(), word());
        assert_eq!(decide(&[Some(&a), Some(&b)]), d(Some(0), true));
        // The higher one arrives late: it takes over.
        assert_eq!(decide(&[None, Some(&b)]), d(Some(1), false));
        assert_eq!(decide(&[Some(&a), Some(&b)]).best, Some(0));
    }

    #[test]
    fn word_synced_waits_only_for_higher_providers() {
        let w = word();
        assert_eq!(decide(&[Some(&w), None, None]), d(Some(0), true));
        assert_eq!(decide(&[None, Some(&w), None]), d(Some(1), false));
    }

    #[test]
    fn line_synced_waits_for_everyone_but_is_shown_meanwhile() {
        let (s, n) = (synced(), Outcome::NotFound);
        assert_eq!(decide(&[Some(&s), None]), d(Some(0), false));
        assert_eq!(decide(&[Some(&s), Some(&n)]), d(Some(0), true));
        // A word-synced answer from a lower provider upgrades it.
        let w = word();
        assert_eq!(decide(&[Some(&s), Some(&w)]), d(Some(1), true));
    }

    #[test]
    fn unsynced_is_the_last_resort() {
        let (p, s, n) = (plain(), synced(), Outcome::NotFound);
        assert_eq!(decide(&[Some(&p), None]), d(Some(0), false));
        assert_eq!(decide(&[Some(&p), Some(&s)]), d(Some(1), true));
        assert_eq!(decide(&[Some(&n), Some(&p), Some(&p)]), d(Some(1), true));
    }

    #[test]
    fn errors_and_timeouts_do_not_win() {
        let (e, t, s) = (Outcome::Error("x".into()), Outcome::Timeout, synced());
        assert_eq!(decide(&[Some(&e), Some(&t), Some(&s), None]), d(Some(2), false));
    }

    #[test]
    fn nothing_when_nobody_has_lyrics() {
        let (n, t) = (Outcome::NotFound, Outcome::Timeout);
        assert_eq!(decide(&[Some(&n), Some(&t)]), d(None, true));
        assert_eq!(decide(&[Some(&n), None]), d(None, false));
        assert_eq!(decide(&[]), d(None, true));
    }
}
