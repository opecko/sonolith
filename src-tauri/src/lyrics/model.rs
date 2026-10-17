//! The one lyrics model every provider's format is turned into.

use serde::{Deserialize, Serialize};

/// A word or syllable with its own timing (word-synced lyrics), in milliseconds.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Word {
    pub start: u32,
    pub end: u32,
    pub text: String,
}

/// A synced line: starts at `start` (ms), ends at `end` when the format says so (else the next line's start).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Line {
    pub start: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub end: Option<u32>,
    pub text: String,
    /// Word / syllable timings, when the provider has them.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub words: Vec<Word>,
}

/// Synced lyrics have `lines`; unsynced ones only `plain` text.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Lyrics {
    pub synced: bool,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub lines: Vec<Line>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub plain: Option<String>,
}

impl Lyrics {
    pub fn synced(mut lines: Vec<Line>) -> Option<Lyrics> {
        lines.retain(|l| !l.text.trim().is_empty() || !l.words.is_empty());
        if lines.is_empty() {
            return None;
        }
        lines.sort_by_key(|l| l.start);
        Some(Lyrics { synced: true, lines, plain: None })
    }

    pub fn plain(text: &str) -> Option<Lyrics> {
        let text = text.trim();
        (!text.is_empty()).then(|| Lyrics { synced: false, lines: Vec::new(), plain: Some(text.to_string()) })
    }

    /// Has word timings on at least one line.
    pub fn word_synced(&self) -> bool {
        self.lines.iter().any(|l| !l.words.is_empty())
    }
}

/// What the player knows about the playing track; providers match their results against it.
#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub duration_sec: Option<f64>,
}
