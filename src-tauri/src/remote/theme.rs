//! The app's colors for the phone page: the frontend sends its resolved `--c-*` tokens, and only known names with
//! plain hex colors get through, so nothing the frontend sends can add CSS of its own.

use std::collections::BTreeMap;

/// The tokens the page uses (src/theme/tokens.ts); its own stylesheet derives the M3 roles from them.
const NAMES: &[&str] = &[
    "bg", "surface", "surface-2", "surface-3", "text", "text-muted", "text-subtle", "accent", "on-accent", "accent-2",
    "outline", "hover", "active", "error", "slider-track",
];

fn hex_color(v: &str) -> bool {
    let Some(h) = v.strip_prefix('#') else { return false };
    matches!(h.len(), 3 | 4 | 6 | 8) && h.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The accepted tokens, by name. Unknown names and other values are dropped (the page keeps its default for them).
pub fn accept(tokens: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    tokens
        .iter()
        .filter(|(k, v)| NAMES.contains(&k.as_str()) && hex_color(v))
        .map(|(k, v)| (k.clone(), v.to_ascii_lowercase()))
        .collect()
}

/// `theme.css`: the tokens on `:root`, and whether the page is light or dark.
pub fn css(tokens: &BTreeMap<String, String>, light: bool) -> String {
    let mut s = String::from(":root{");
    s.push_str(if light { "color-scheme:light;" } else { "color-scheme:dark;" });
    for (k, v) in tokens {
        s.push_str(&format!("--c-{k}:{v};"));
    }
    s.push('}');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_hex_tokens_pass() {
        let mut t = BTreeMap::new();
        t.insert("accent".to_string(), "#FF0033".to_string());
        t.insert("bg".to_string(), "red;}body{display:none".to_string());
        t.insert("text".to_string(), "#fff".to_string());
        t.insert("evil".to_string(), "#000".to_string());
        t.insert("outline".to_string(), "#ffffff1a".to_string());
        t.insert("surface".to_string(), "#12345".to_string());
        let ok = accept(&t);
        assert_eq!(ok.keys().map(String::as_str).collect::<Vec<_>>(), ["accent", "outline", "text"]);
        assert_eq!(css(&ok, false), ":root{color-scheme:dark;--c-accent:#ff0033;--c-outline:#ffffff1a;--c-text:#fff;}");
    }
}
