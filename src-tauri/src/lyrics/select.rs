//! Which provider wins: pure, over results that arrive in any order. Providers run in parallel, but a
//! lower-priority result may only win once every higher one has finished without synced lyrics.

use super::model::Lyrics;

#[derive(Clone, Debug)]
pub enum Outcome {
    Found { lyrics: Lyrics, source: Option<String> },
    NotFound,
    Error(String),
    Timeout,
}

impl Outcome {
    pub fn synced(&self) -> bool {
        matches!(self, Outcome::Found { lyrics, .. } if lyrics.synced)
    }
    pub fn label(&self) -> &'static str {
        match self {
            Outcome::Found { lyrics, .. } if lyrics.synced => "synced",
            Outcome::Found { .. } => "unsynced",
            Outcome::NotFound => "none",
            Outcome::Error(_) => "error",
            Outcome::Timeout => "timeout",
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Decision {
    /// A higher-priority provider is still running.
    Wait,
    /// The provider at this priority index wins.
    Pick(usize),
    /// Everyone finished and nobody has lyrics.
    Nothing,
}

/// `results[i]` is the outcome of the provider with priority `i` (0 = highest), `None` while it runs. The first
/// provider with synced lyrics wins once all above it are done; with no synced lyrics anywhere, the
/// highest-priority unsynced result, once everyone is done.
pub fn decide(results: &[Option<&Outcome>]) -> Decision {
    for (i, r) in results.iter().enumerate() {
        match r {
            None => return Decision::Wait,
            Some(o) if o.synced() => return Decision::Pick(i),
            Some(_) => {}
        }
    }
    match results.iter().position(|r| matches!(r, Some(Outcome::Found { .. }))) {
        Some(i) => Decision::Pick(i),
        None => Decision::Nothing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lyrics::model::Line;

    fn synced() -> Outcome {
        Outcome::Found { lyrics: Lyrics::synced(vec![Line { start: 0, end: None, text: "a".into(), words: vec![] }]).unwrap(), source: None }
    }
    fn plain() -> Outcome {
        Outcome::Found { lyrics: Lyrics::plain("a").unwrap(), source: None }
    }

    #[test]
    fn waits_for_higher_priorities() {
        let (s, n) = (synced(), Outcome::NotFound);
        // Provider 2 has synced lyrics, but provider 0 still runs.
        assert_eq!(decide(&[None, Some(&n), Some(&s)]), Decision::Wait);
        assert_eq!(decide(&[Some(&n), Some(&n), Some(&s)]), Decision::Pick(2));
    }

    #[test]
    fn first_synced_wins_without_waiting_for_lower_ones() {
        let s = synced();
        assert_eq!(decide(&[Some(&s), None, None]), Decision::Pick(0));
        let (e, t) = (Outcome::Error("x".into()), Outcome::Timeout);
        assert_eq!(decide(&[Some(&e), Some(&t), Some(&s), None]), Decision::Pick(2));
    }

    #[test]
    fn unsynced_only_as_a_fallback_after_everyone() {
        let (p, s, n) = (plain(), synced(), Outcome::NotFound);
        // Provider 0 has plain lyrics; 1 may still have synced ones.
        assert_eq!(decide(&[Some(&p), None]), Decision::Wait);
        assert_eq!(decide(&[Some(&p), Some(&s)]), Decision::Pick(1));
        assert_eq!(decide(&[Some(&n), Some(&p), Some(&p)]), Decision::Pick(1));
    }

    #[test]
    fn nothing_when_nobody_has_lyrics() {
        let (n, t) = (Outcome::NotFound, Outcome::Timeout);
        assert_eq!(decide(&[Some(&n), Some(&t)]), Decision::Nothing);
        assert_eq!(decide(&[]), Decision::Nothing);
    }
}
