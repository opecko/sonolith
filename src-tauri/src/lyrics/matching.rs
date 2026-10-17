//! Is a provider's result the song that plays? Pure; never show lyrics of a different song.

/// Results whose length differs more than this from the playing track are a different recording.
pub const DURATION_TOLERANCE_SEC: f64 = 3.0;

const NOISE: [&str; 16] = [
    "feat", "ft", "featuring", "remaster", "remastered", "official", "video", "audio", "lyric", "lyrics", "visualizer",
    "explicit", "clean", "radio edit", "mono", "stereo",
];

/// Lowercase letters and digits only, words separated by single spaces (diacritics folded for Latin text).
pub fn simplify(s: &str) -> String {
    let folded: String = s
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'Á' | 'À' | 'Â' | 'Ä' => 'a',
            'č' | 'ç' | 'Č' | 'Ç' => 'c',
            'ď' | 'Ď' => 'd',
            'é' | 'è' | 'ê' | 'ë' | 'ě' | 'É' | 'È' | 'Ě' => 'e',
            'í' | 'ì' | 'î' | 'ï' | 'Í' => 'i',
            'ň' | 'ñ' | 'Ň' | 'Ñ' => 'n',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'Ó' | 'Ö' => 'o',
            'ř' | 'Ř' => 'r',
            'š' | 'Š' => 's',
            'ť' | 'Ť' => 't',
            'ú' | 'ù' | 'û' | 'ü' | 'ů' | 'Ú' | 'Ü' | 'Ů' => 'u',
            'ý' | 'ÿ' | 'Ý' => 'y',
            'ž' | 'Ž' => 'z',
            c => c,
        })
        .collect();
    folded.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

/// A title without what versions add: "(feat. X)", "[Remastered 2011]", "- Radio Edit", "(Official Video)".
pub fn normalize_title(title: &str) -> String {
    let mut t = title.to_string();
    // Bracketed parts that are only version noise go; others ("(Don't Fear) The Reaper") stay.
    for (open, close) in [('(', ')'), ('[', ']')] {
        let mut out = String::new();
        let mut rest = t.as_str();
        while let Some(i) = rest.find(open) {
            let Some(j) = rest[i..].find(close) else { break };
            let inner = simplify(&rest[i + 1..i + j]);
            out.push_str(&rest[..i]);
            if !is_noise(&inner) {
                out.push_str(&rest[i..=i + j]);
            }
            rest = &rest[i + j + 1..];
        }
        out.push_str(rest);
        t = out;
    }
    // " - Remastered 2011", " - Radio Edit"; also "feat. X" without brackets.
    if let Some(i) = t.rfind(" - ") {
        if is_noise(&simplify(&t[i + 3..])) {
            t.truncate(i);
        }
    }
    let s = simplify(&t);
    let cut = s.split(' ').position(|w| w == "feat" || w == "ft" || w == "featuring");
    match cut {
        Some(0) | None => s,
        Some(n) => s.split(' ').take(n).collect::<Vec<_>>().join(" "),
    }
}

fn is_noise(simple: &str) -> bool {
    !simple.is_empty() && (NOISE.iter().any(|n| simple == *n || simple.starts_with(&format!("{n} ")) || simple.ends_with(&format!(" {n}"))) || simple.contains("version") && simple.contains("remaster"))
}

/// Equal after normalizing, or one is the other plus whole extra words ("Song" / "Song Pt 2" stays apart only past
/// a dozen extra characters); "Creep" never matches "Creepin'".
pub fn titles_match(wanted: &str, got: &str) -> bool {
    let (a, b) = (normalize_title(wanted), normalize_title(got));
    if a.is_empty() || b.is_empty() {
        return false;
    }
    let (short, long) = if a.len() <= b.len() { (&a, &b) } else { (&b, &a) };
    a == b || (short.len() >= 4 && long.starts_with(&format!("{short} ")) && long.len() - short.len() <= 12)
}

/// Some artist of the playing track appears among the result's artists ("A & B", "A, B", "A feat. B", "A、B").
pub fn artists_match(wanted: &str, got: &str) -> bool {
    let got = format!(" {} ", simplify(got));
    if got.trim().is_empty() {
        return false;
    }
    let mut names = vec![wanted.to_string()];
    for sep in [",", "&", "、", "/", " x ", " X ", " and ", " feat. ", " ft. ", " featuring "] {
        names = names.iter().flat_map(|n| n.split(sep).map(str::to_string).collect::<Vec<_>>()).collect();
    }
    names.iter().map(|n| simplify(n)).filter(|n| n.len() > 1).any(|n| got.contains(&format!(" {n} ")))
}

/// Both lengths known and further apart than the tolerance: not the same recording.
pub fn duration_ok(wanted: Option<f64>, got: Option<f64>) -> bool {
    match (wanted, got) {
        (Some(w), Some(g)) if w > 0.0 && g > 0.0 => (w - g).abs() <= DURATION_TOLERANCE_SEC,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_lose_version_noise() {
        assert_eq!(normalize_title("Creep (Remastered 2009)"), "creep");
        assert_eq!(normalize_title("Song Name - Radio Edit"), "song name");
        assert_eq!(normalize_title("Not Like Us (feat. Someone)"), "not like us");
        assert_eq!(normalize_title("Track feat. Guest"), "track");
        assert_eq!(normalize_title("Never Gonna Give You Up (Official Video)"), "never gonna give you up");
        assert_eq!(normalize_title("(Don't Fear) The Reaper"), "don t fear the reaper");
        assert_eq!(normalize_title("Příliš žluťoučký kůň"), "prilis zlutoucky kun");
    }

    #[test]
    fn title_matching() {
        assert!(titles_match("The Less I Know the Better", "The Less I Know The Better (Explicit)"));
        assert!(titles_match("Creep", "Creep - Remastered"));
        assert!(!titles_match("Creep", "Creepin'"));
        assert!(!titles_match("Hello", "Hello Again From The Other Side Of The World Tonight"));
        assert!(!titles_match("", "x"));
    }

    #[test]
    fn artist_matching() {
        assert!(artists_match("Tame Impala", "Tame Impala"));
        assert!(artists_match("Simon & Garfunkel", "Simon & Garfunkel"));
        assert!(artists_match("Kendrick Lamar, SZA", "SZA"));
        assert!(artists_match("The Weeknd", "The Weeknd、Daft Punk"));
        assert!(!artists_match("Radiohead", "3slow2"));
    }

    #[test]
    fn durations_within_three_seconds() {
        assert!(duration_ok(Some(216.0), Some(218.5)));
        assert!(!duration_ok(Some(216.0), Some(253.0)));
        assert!(duration_ok(None, Some(253.0)));
        assert!(duration_ok(Some(216.0), None));
    }
}
