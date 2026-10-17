//! Pure parsers: each provider's format → `Lyrics`. No I/O; tested with recorded responses (fixtures/, lyric
//! text replaced by placeholders, timings as recorded).

use super::model::{Line, Lyrics, Word};
use serde_json::Value;

/// "mm:ss.xx", "mm:ss", "h:mm:ss.xxx", "ss.xxx" (TTML clock values too) → milliseconds.
pub fn parse_clock(s: &str) -> Option<u32> {
    let s = s.trim().trim_end_matches('s');
    if s.is_empty() {
        return None;
    }
    let mut total = 0f64;
    for part in s.split(':') {
        let v: f64 = part.parse().ok()?;
        if !v.is_finite() || v < 0.0 {
            return None;
        }
        total = total * 60.0 + v;
    }
    Some((total * 1000.0).round() as u32)
}

/// LRC: `[mm:ss.xx]text` (several tags per line allowed), `[offset:±ms]`, enhanced word tags `<mm:ss.xx>`.
/// Metadata tags (`[ti:…]`, `[ar:…]`) are skipped. No timestamps at all: the text is plain lyrics.
pub fn parse_lrc(text: &str) -> Option<Lyrics> {
    let mut lines = Vec::new();
    let mut offset: i64 = 0;
    let mut any_tag = false;
    for raw in text.lines() {
        let mut rest = raw.trim();
        let mut starts = Vec::new();
        while let Some(stripped) = rest.strip_prefix('[') {
            let Some(close) = stripped.find(']') else { break };
            let tag = &stripped[..close];
            if let Some(ms) = parse_clock(tag).filter(|_| tag.contains(':') || tag.contains('.')) {
                starts.push(ms);
            } else if let Some(v) = tag.strip_prefix("offset:") {
                offset = v.trim().parse().unwrap_or(0);
            }
            rest = &stripped[close + 1..];
        }
        if starts.is_empty() {
            continue;
        }
        any_tag = true;
        let (text, words) = enhanced_words(rest);
        for s in starts {
            let start = (s as i64 - offset).max(0) as u32;
            lines.push(Line { start, end: None, text: text.clone(), words: words.clone(), background: Vec::new() });
        }
    }
    if !any_tag {
        return Lyrics::plain(text);
    }
    Lyrics::synced(lines)
}

/// Enhanced LRC words: "<00:01.00>Some <00:01.40>words" → text "Some words" + timed words.
fn enhanced_words(s: &str) -> (String, Vec<Word>) {
    if !s.contains('<') {
        return (s.trim().to_string(), Vec::new());
    }
    let mut words: Vec<Word> = Vec::new();
    let mut text = String::new();
    let mut rest = s;
    while let Some(open) = rest.find('<') {
        let before = &rest[..open];
        text.push_str(before);
        if let Some(w) = words.last_mut() {
            w.text.push_str(before);
        }
        let Some(close) = rest[open..].find('>') else { break };
        let tag = &rest[open + 1..open + close];
        rest = &rest[open + close + 1..];
        if let Some(ms) = parse_clock(tag) {
            if let Some(w) = words.last_mut() {
                w.end = ms;
            }
            words.push(Word { start: ms, end: ms, text: String::new() });
        }
    }
    text.push_str(rest);
    if let Some(w) = words.last_mut() {
        w.text.push_str(rest);
    }
    words.retain(|w| !w.text.trim().is_empty());
    (text.trim().to_string(), words)
}

/// Apple-style TTML (Better Lyrics, Unison): `<p begin end>` lines with `<span begin end>` words; whitespace text
/// between spans separates words. Background vocals (`ttm:role="x-bg"`) go to `background` with their own word timings. `itunes:timing="None"` or
/// untimed `<p>`: plain lyrics.
pub fn parse_ttml(xml: &str) -> Option<Lyrics> {
    let doc = roxmltree::Document::parse(xml).ok()?;
    let mut lines = Vec::new();
    let mut plain = Vec::new();
    for p in doc.descendants().filter(|n| n.has_tag_name("p")) {
        let begin = p.attribute("begin").and_then(parse_clock);
        let end = p.attribute("end").and_then(parse_clock);
        let mut words = Vec::new();
        let mut background = Vec::new();
        let mut text = String::new();
        for child in p.children() {
            if child.is_text() {
                let t = child.text().unwrap_or("");
                text.push_str(t);
                if let Some(w) = words.last_mut() {
                    let w: &mut Word = w;
                    if t.chars().all(char::is_whitespace) && !t.is_empty() && !w.text.ends_with(' ') {
                        w.text.push(' ');
                    }
                }
            } else if child.is_element() && child.has_tag_name("span") {
                if child.attributes().any(|a| a.name() == "role" && a.value() == "x-bg") {
                    background = ttml_background(child);
                    continue;
                }
                let t: String = child.descendants().filter(|n| n.is_text()).filter_map(|n| n.text()).collect();
                text.push_str(&t);
                if let (Some(s), Some(e)) = (child.attribute("begin").and_then(parse_clock), child.attribute("end").and_then(parse_clock)) {
                    words.push(Word { start: s, end: e, text: t });
                }
            }
        }
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        match begin {
            Some(start) => {
                let word_sync = words.len() > 1;
                lines.push(Line { start, end, text, words: if word_sync { words } else { Vec::new() }, background: if word_sync { background } else { Vec::new() } })
            }
            None => plain.push(text),
        }
    }
    if lines.is_empty() {
        return Lyrics::plain(&plain.join("\n"));
    }
    Lyrics::synced(lines)
}

/// The timed spans of an `x-bg` span, spaces kept between words like the main line's.
fn ttml_background(bg: roxmltree::Node) -> Vec<Word> {
    let mut words: Vec<Word> = Vec::new();
    for c in bg.children() {
        if c.is_text() {
            let t = c.text().unwrap_or("");
            if let Some(w) = words.last_mut() {
                if !t.is_empty() && t.chars().all(char::is_whitespace) && !w.text.ends_with(' ') {
                    w.text.push(' ');
                }
            }
        } else if c.is_element() && c.has_tag_name("span") {
            let t: String = c.descendants().filter(|n| n.is_text()).filter_map(|n| n.text()).collect();
            if let (Some(s), Some(e)) = (c.attribute("begin").and_then(parse_clock), c.attribute("end").and_then(parse_clock)) {
                words.push(Word { start: s, end: e, text: t });
            }
        }
    }
    words
}

/// The total length a TTML document states (`<body dur>`), in seconds; used to check the match.
pub fn ttml_duration(xml: &str) -> Option<f64> {
    let doc = roxmltree::Document::parse(xml).ok()?;
    let body = doc.descendants().find(|n| n.has_tag_name("body"))?;
    body.attribute("dur").and_then(parse_clock).map(|ms| ms as f64 / 1000.0)
}

/// LyricsPlus JSON: `{ type: "Word"|"Line"|"None", lyrics: [{ time, duration, text, syllabus: [{ time, duration,
/// text, isBackground }] }] }`, times in ms.
pub fn parse_lyricsplus(v: &Value) -> Option<Lyrics> {
    let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
    let rows = v.get("lyrics")?.as_array()?;
    if kind.eq_ignore_ascii_case("none") {
        let text: Vec<&str> = rows.iter().filter_map(|r| r.get("text").and_then(Value::as_str)).collect();
        return Lyrics::plain(&text.join("\n"));
    }
    let ms = |x: Option<&Value>| x.and_then(Value::as_f64).filter(|v| *v >= 0.0).map(|v| v.round() as u32);
    let mut lines = Vec::new();
    for r in rows {
        let Some(start) = ms(r.get("time")) else { continue };
        let dur = ms(r.get("duration")).unwrap_or(0);
        let syllables = |bg: bool| -> Vec<Word> {
            r.get("syllabus")
                .and_then(Value::as_array)
                .map(|s| {
                    s.iter()
                        .filter(|w| w.get("isBackground").and_then(Value::as_bool).unwrap_or(false) == bg)
                        .filter_map(|w| {
                            let s = ms(w.get("time"))?;
                            let d = ms(w.get("duration")).unwrap_or(0);
                            Some(Word { start: s, end: s + d, text: w.get("text")?.as_str()?.to_string() })
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        let (words, background) = (syllables(false), syllables(true));
        let text = r.get("text").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| words.iter().map(|w| w.text.as_str()).collect());
        let word_sync = kind.eq_ignore_ascii_case("word") && words.len() > 1;
        let (words, background) = if word_sync { (words, background) } else { (Vec::new(), Vec::new()) };
        lines.push(Line { start, end: (dur > 0).then_some(start + dur), text: text.trim().to_string(), words, background });
    }
    Lyrics::synced(lines)
}

/// YouTube Music (mobile client) timed lyrics: `timedLyricsData: [{ lyricLine, cueRange: { startTimeMilliseconds,
/// endTimeMilliseconds } }]`, plus the attribution ("Source: Musixmatch").
pub fn parse_youtube(v: &Value) -> Option<(Lyrics, Option<String>)> {
    let data = v.pointer("/contents/elementRenderer/newElement/type/componentType/model/timedLyricsModel/lyricsData")?;
    let rows = data.get("timedLyricsData")?.as_array()?;
    let num = |x: Option<&Value>| x.and_then(|v| v.as_str().and_then(|s| s.parse::<u32>().ok()).or_else(|| v.as_u64().map(|n| n as u32)));
    let lines = rows
        .iter()
        .filter_map(|r| {
            let text = r.get("lyricLine")?.as_str()?.trim().to_string();
            let start = num(r.pointer("/cueRange/startTimeMilliseconds"))?;
            let end = num(r.pointer("/cueRange/endTimeMilliseconds"));
            // "♪" marks an instrumental stretch: no line to show.
            (text != "♪").then_some(Line { start, end, text, words: Vec::new(), background: Vec::new() })
        })
        .collect();
    let source = data.get("sourceMessage").and_then(Value::as_str).map(|s| s.trim_start_matches("Source:").trim().to_string());
    Some((Lyrics::synced(lines)?, source))
}

/// The lyrics tab's browse id (`MPLY…`) in a masked mobile `/next` response.
pub fn youtube_lyrics_id(v: &Value) -> Option<String> {
    let tabs = v.pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs")?.as_array()?;
    tabs.iter().find_map(|t| {
        let ep = t.pointer("/tabRenderer/endpoint/browseEndpoint")?;
        let page = ep.pointer("/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType")?.as_str()?;
        (page == "MUSIC_PAGE_TYPE_TRACK_LYRICS").then(|| ep.get("browseId")?.as_str().map(str::to_string)).flatten()
    })
}

/// KuGou's LRC, after base64: header tags plus credit lines ("Title - Artist" at 0:00, "Written by：…",
/// 作词 / 作曲 …) that aren't lyrics.
pub fn parse_kugou(lrc: &str) -> Option<Lyrics> {
    let mut lyrics = parse_lrc(lrc)?;
    if lyrics.synced {
        lyrics.lines.retain(|l| !is_credit_line(&l.text, l.start));
        return Lyrics::synced(lyrics.lines);
    }
    Some(lyrics)
}

fn is_credit_line(text: &str, start: u32) -> bool {
    const KEYS: [&str; 14] = ["作词", "作曲", "编曲", "制作", "监制", "混音", "词：", "曲：", "written by", "composed by", "lyrics by", "producer", "composer", "lyricist"];
    let lower = text.to_lowercase();
    (start < 1000 && text.contains(" - ")) || KEYS.iter().any(|k| lower.contains(k)) || (lower.contains('：') && start < 20_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let path = format!("{}/src/lyrics/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn clock_values() {
        assert_eq!(parse_clock("00:24.95"), Some(24_950));
        assert_eq!(parse_clock("1:02.345"), Some(62_345));
        assert_eq!(parse_clock("24.693"), Some(24_693));
        assert_eq!(parse_clock("3:38.543"), Some(218_543));
        assert_eq!(parse_clock("0:01:02"), Some(62_000));
        assert_eq!(parse_clock("x"), None);
    }

    #[test]
    fn lrc_lines_offsets_and_words() {
        let l = parse_lrc("[ti:T]\n[offset:500]\n[00:01.00][00:10.00]Chorus\n[00:05.50]<00:05.50>Two <00:06.00>words\n").unwrap();
        assert!(l.synced);
        assert_eq!(l.lines.iter().map(|x| (x.start, x.text.as_str())).collect::<Vec<_>>(), vec![(500, "Chorus"), (5000, "Two words"), (9500, "Chorus")]);
        assert_eq!(l.lines[1].words.len(), 2);
        assert_eq!(l.lines[1].words[0], Word { start: 5500, end: 6000, text: "Two ".into() });
    }

    #[test]
    fn lrc_without_tags_is_plain() {
        let l = parse_lrc("Just\nwords").unwrap();
        assert!(!l.synced);
        assert_eq!(l.plain.as_deref(), Some("Just\nwords"));
    }

    #[test]
    fn lrclib_synced_and_plain() {
        let v = fixture("lrclib.json");
        let synced = parse_lrc(v["syncedLyrics"].as_str().unwrap()).unwrap();
        assert!(synced.synced && synced.lines.len() > 20);
        assert_eq!(synced.lines[0].text, "Line 1");
        assert!(synced.lines.windows(2).all(|w| w[0].start <= w[1].start));
        let plain = parse_lrc(v["plainLyrics"].as_str().unwrap()).unwrap();
        assert!(!plain.synced);
    }

    #[test]
    fn better_lyrics_ttml_word_synced() {
        let v = fixture("betterlyrics.json");
        let ttml = v["ttml"].as_str().unwrap();
        let l = parse_ttml(ttml).unwrap();
        assert!(l.synced && l.word_synced());
        assert_eq!(l.lines[0].start, 24_693);
        assert!(l.lines[0].words.len() > 1);
        assert!((ttml_duration(ttml).unwrap() - 218.543).abs() < 0.01);
    }

    #[test]
    fn ttml_line_timing_and_untimed() {
        let line = r#"<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1.0" end="2.5">Hello there</p></div></body></tt>"#;
        let l = parse_ttml(line).unwrap();
        assert!(l.synced && !l.word_synced());
        assert_eq!((l.lines[0].start, l.lines[0].end, l.lines[0].text.as_str()), (1000, Some(2500), "Hello there"));
        let none = r#"<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>One</p><p>Two</p></div></body></tt>"#;
        assert_eq!(parse_ttml(none).unwrap().plain.as_deref(), Some("One\nTwo"));
    }

    #[test]
    fn lyricsplus_word_synced() {
        let l = parse_lyricsplus(&fixture("lyricsplus.json")).unwrap();
        assert!(l.synced && l.word_synced());
        assert_eq!(l.lines[0].text, "Line 1");
        assert!(l.lines[0].end.is_some());
    }

    #[test]
    fn youtube_timed_lyrics_and_tab_id() {
        let (l, source) = parse_youtube(&fixture("youtube-lyrics.json")).unwrap();
        assert!(l.synced && !l.word_synced());
        assert_eq!(l.lines[0].start, 25_090);
        assert!(l.lines.iter().all(|x| x.text != "♪"));
        assert_eq!(source.as_deref(), Some("Musixmatch"));
        assert_eq!(youtube_lyrics_id(&fixture("youtube-next.json")).as_deref(), Some("MPLYt_AjwAqo5hI0U-7"));
    }

    #[test]
    fn kugou_drops_headers_and_credits() {
        use base64::Engine;
        let v = fixture("kugou-download.json");
        let bytes = base64::engine::general_purpose::STANDARD.decode(v["content"].as_str().unwrap()).unwrap();
        let l = parse_kugou(&String::from_utf8(bytes).unwrap()).unwrap();
        assert_eq!(l.lines[0].text, "Line 1");
        assert!(l.lines.iter().all(|x| !x.text.contains("Written by") && !x.text.contains(" - ")));
    }

    #[test]
    fn background_vocals_kept_apart() {
        let xml = r#"<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
            <p begin="1.0" end="4.0"><span begin="1.0" end="1.5">Main</span> <span begin="1.5" end="2.0">line</span><span ttm:role="x-bg"><span begin="2.0" end="2.5">(ooh</span> <span begin="2.5" end="3.0">yeah)</span></span></p>
        </div></body></tt>"#;
        let l = parse_ttml(xml).unwrap();
        assert_eq!(l.lines[0].text, "Main line");
        assert_eq!(l.lines[0].background.iter().map(|w| w.text.as_str()).collect::<String>(), "(ooh yeah)");
        assert_eq!(l.lines[0].background[0].start, 2000);

        let v: Value = serde_json::from_str(r#"{"type":"Word","lyrics":[{"time":1000,"duration":3000,"text":"Main line","syllabus":[
            {"time":1000,"duration":500,"text":"Main "},{"time":1500,"duration":500,"text":"line"},{"time":2000,"duration":500,"text":"(ooh)","isBackground":true}]}]}"#).unwrap();
        let l = parse_lyricsplus(&v).unwrap();
        assert_eq!(l.lines[0].words.len(), 2);
        assert_eq!(l.lines[0].background[0].text, "(ooh)");
    }

    #[test]
    fn unison_lrc_shape() {
        let v = fixture("unison-lrc.json");
        let l = parse_lrc(v["data"]["lyrics"].as_str().unwrap()).unwrap();
        assert_eq!(l.lines.len(), 3);
        assert_eq!(l.lines[2].start, 8250);
    }
}
