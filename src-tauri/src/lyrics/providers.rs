//! One `Source` per provider: a request to its public endpoint, its format through `parse`, and a check that the
//! result is the playing song (`matching`). Endpoints and shapes: docs/lyrics-providers.md.

use super::matching::{artists_match, duration_ok, titles_match};
use super::model::Request;
use super::parse;
use super::select::Outcome;
use base64::Engine;
use serde_json::Value;
use std::future::Future;
use std::pin::Pin;
use tauri_plugin_http::reqwest::{Client, RequestBuilder, StatusCode};

pub type Fetch<'a> = Pin<Box<dyn Future<Output = Outcome> + Send + 'a>>;

/// A lyrics provider.
pub trait Source: Sync {
    /// Stable id (settings, cache, credits): "youtube", "betterlyrics", "unison", "lyricsplus", "kugou", "lrclib".
    fn id(&self) -> &'static str;
    fn fetch<'a>(&'a self, http: &'a Client, req: &'a Request) -> Fetch<'a>;
    /// How long it may take before it counts as timed out.
    fn timeout(&self) -> std::time::Duration {
        std::time::Duration::from_secs(4)
    }
}

pub static SOURCES: [&dyn Source; 6] = [&YouTubeMusic, &BetterLyrics, &Unison, &LyricsPlus, &KuGou, &Lrclib];

pub fn source(id: &str) -> Option<&'static dyn Source> {
    SOURCES.iter().copied().find(|s| s.id() == id)
}

/// GET/POST → JSON. `Ok(None)` when the provider has nothing for us: 404, or 401 (Better Lyrics answers queries it
/// hasn't cached only with an API key); `Err` for anything else that went wrong.
async fn json(rb: RequestBuilder) -> Result<Option<Value>, String> {
    let res = rb.header("Accept", "application/json").send().await.map_err(|e| e.to_string())?;
    if res.status() == StatusCode::NOT_FOUND || res.status() == StatusCode::UNAUTHORIZED {
        return Ok(None);
    }
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string())
}

fn found(lyrics: Option<super::model::Lyrics>, source: Option<String>) -> Outcome {
    lyrics.map_or(Outcome::NotFound, |lyrics| Outcome::Found { lyrics, source })
}

fn secs(req: &Request) -> Option<String> {
    req.duration_sec.filter(|d| *d > 0.0).map(|d| (d.round() as u64).to_string())
}

/// The common query of the title / artist / album / duration APIs, under each one's own parameter names.
fn query(req: &Request, names: [&str; 4]) -> Vec<(String, String)> {
    let mut q = vec![(names[0].to_string(), req.title.clone()), (names[1].to_string(), req.artist.clone())];
    if let Some(a) = req.album.as_ref().filter(|a| !a.is_empty()) {
        q.push((names[2].to_string(), a.clone()));
    }
    if let Some(d) = secs(req) {
        q.push((names[3].to_string(), d));
    }
    q
}

// ---------- YouTube Music ----------

/// Timed lyrics come only to the Android Music client; the field masks keep 3 MB / 650 kB responses at ~1 / 5 kB.
pub struct YouTubeMusic;
const YT_CLIENT: &str = r#"{"client":{"clientName":"ANDROID_MUSIC","clientVersion":"7.21.50","hl":"en"}}"#;
const YT_NEXT_MASK: &str = "contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer.tabs.tabRenderer(unselectable,endpoint.browseEndpoint(browseId,browseEndpointContextSupportedConfigs))";
const YT_LYRICS_MASK: &str = "contents.elementRenderer.newElement.type.componentType.model.timedLyricsModel.lyricsData(timedLyricsData,sourceMessage)";

impl Source for YouTubeMusic {
    fn id(&self) -> &'static str {
        "youtube"
    }
    fn fetch<'a>(&'a self, http: &'a Client, req: &'a Request) -> Fetch<'a> {
        Box::pin(async move {
            let ctx: Value = serde_json::from_str(YT_CLIENT).unwrap();
            let post = |endpoint: &str, mask: &'static str, body: Value| {
                http.post(format!("https://music.youtube.com/youtubei/v1/{endpoint}?prettyPrint=false"))
                    .header("Content-Type", "application/json")
                    .header("X-Goog-FieldMask", mask)
                    .body(body.to_string())
            };
            let next = match json(post("next", YT_NEXT_MASK, serde_json::json!({ "context": ctx, "videoId": req.video_id }))).await {
                Ok(Some(v)) => v,
                Ok(None) => return Outcome::NotFound,
                Err(e) => return Outcome::Error(e),
            };
            let Some(id) = parse::youtube_lyrics_id(&next) else { return Outcome::NotFound };
            match json(post("browse", YT_LYRICS_MASK, serde_json::json!({ "context": ctx, "browseId": id }))).await {
                Ok(Some(v)) => match parse::parse_youtube(&v) {
                    Some((lyrics, source)) => Outcome::Found { lyrics, source },
                    // Lyrics only as plain text: the app's own lyrics tab already shows those.
                    None => Outcome::NotFound,
                },
                Ok(None) => Outcome::NotFound,
                Err(e) => Outcome::Error(e),
            }
        })
    }
}

// ---------- Better Lyrics ----------

pub struct BetterLyrics;
impl Source for BetterLyrics {
    fn id(&self) -> &'static str {
        "betterlyrics"
    }
    fn fetch<'a>(&'a self, http: &'a Client, req: &'a Request) -> Fetch<'a> {
        Box::pin(async move {
            let rb = http.get("https://lyrics-api.boidu.dev/getLyrics").query(&query(req, ["s", "a", "al", "d"]));
            match json(rb).await {
                Ok(Some(v)) => {
                    let Some(ttml) = v.get("ttml").and_then(Value::as_str).filter(|t| !t.is_empty()) else { return Outcome::NotFound };
                    // No title in the answer; the length tells a different recording apart.
                    if !duration_ok(req.duration_sec, parse::ttml_duration(ttml)) {
                        return Outcome::NotFound;
                    }
                    found(parse::parse_ttml(ttml), None)
                }
                Ok(None) => Outcome::NotFound,
                Err(e) => Outcome::Error(e),
            }
        })
    }
}

// ---------- Unison ----------

pub struct Unison;
impl Source for Unison {
    fn id(&self) -> &'static str {
        "unison"
    }
    fn fetch<'a>(&'a self, http: &'a Client, req: &'a Request) -> Fetch<'a> {
        Box::pin(async move {
            let rb = http.get("https://unison.betterlyrics.org/lyrics").query(&query(req, ["song", "artist", "album", "duration"]));
            match json(rb).await {
                Ok(Some(v)) => {
                    let Some(text) = v.pointer("/data/lyrics").and_then(Value::as_str) else { return Outcome::NotFound };
                    let lyrics = if v.pointer("/data/format").and_then(Value::as_str) == Some("ttml") {
                        if !duration_ok(req.duration_sec, parse::ttml_duration(text)) {
                            return Outcome::NotFound;
                        }
                        parse::parse_ttml(text)
                    } else {
                        parse::parse_lrc(text)
                    };
                    found(lyrics, None)
                }
                Ok(None) => Outcome::NotFound,
                Err(e) => Outcome::Error(e),
            }
        })
    }
}

// ---------- LyricsPlus ----------

pub struct LyricsPlus;
impl Source for LyricsPlus {
    fn id(&self) -> &'static str {
        "lyricsplus"
    }
    fn fetch<'a>(&'a self, http: &'a Client, req: &'a Request) -> Fetch<'a> {
        Box::pin(async move {
            let rb = http.get("https://lyricsplus.binimum.org/v2/lyrics/get").query(&query(req, ["title", "artist", "album", "duration"]));
            match json(rb).await {
                Ok(Some(v)) => {
                    if let Some(t) = v.pointer("/metadata/title").and_then(Value::as_str) {
                        if !titles_match(&req.title, t) {
                            return Outcome::NotFound;
                        }
                    }
                    found(parse::parse_lyricsplus(&v), None)
                }
                Ok(None) => Outcome::NotFound,
                Err(e) => Outcome::Error(e),
            }
        })
    }
}

// ---------- KuGou ----------

pub struct KuGou;
impl Source for KuGou {
    fn id(&self) -> &'static str {
        "kugou"
    }
    /// Three requests in a row (song, candidates, download): ~4–5 s.
    fn timeout(&self) -> std::time::Duration {
        std::time::Duration::from_secs(7)
    }
    fn fetch<'a>(&'a self, http: &'a Client, req: &'a Request) -> Fetch<'a> {
        Box::pin(async move {
            let keyword = format!("{} {}", req.artist, req.title);
            let search = http
                .get("https://mobileservice.kugou.com/api/v3/search/song")
                .query(&[("version", "9108"), ("plat", "0"), ("pagesize", "8"), ("showtype", "0"), ("keyword", keyword.as_str())]);
            let songs = match json(search).await {
                Ok(Some(v)) => v.pointer("/data/info").and_then(Value::as_array).cloned().unwrap_or_default(),
                Ok(None) => return Outcome::NotFound,
                Err(e) => return Outcome::Error(e),
            };
            let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            let Some(song) = songs.iter().find(|x| {
                titles_match(&req.title, &s(x, "songname")) && artists_match(&req.artist, &s(x, "singername")) && duration_ok(req.duration_sec, x.get("duration").and_then(Value::as_f64))
            }) else {
                return Outcome::NotFound;
            };
            let mut q = vec![("ver", "1".to_string()), ("man", "yes".into()), ("client", "pc".into()), ("hash", s(song, "hash")), ("keyword", keyword.clone())];
            if let Some(d) = req.duration_sec {
                q.push(("duration", ((d * 1000.0).round() as u64).to_string()));
            }
            let candidates = match json(http.get("https://lyrics.kugou.com/search").query(&q)).await {
                Ok(Some(v)) => v.get("candidates").and_then(Value::as_array).cloned().unwrap_or_default(),
                Ok(None) => return Outcome::NotFound,
                Err(e) => return Outcome::Error(e),
            };
            let Some(c) = candidates.iter().find(|c| duration_ok(req.duration_sec, c.get("duration").and_then(Value::as_f64).map(|ms| ms / 1000.0))) else {
                return Outcome::NotFound;
            };
            let id = c.get("id").map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).unwrap_or_default();
            let dl = http.get("https://lyrics.kugou.com/download").query(&[
                ("ver", "1"), ("client", "pc"), ("charset", "utf8"), ("fmt", "lrc"), ("id", id.as_str()), ("accesskey", s(c, "accesskey").as_str()),
            ]);
            match json(dl).await {
                Ok(Some(v)) => {
                    let Some(b64) = v.get("content").and_then(Value::as_str) else { return Outcome::NotFound };
                    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else { return Outcome::Error("bad base64".into()) };
                    found(parse::parse_kugou(&String::from_utf8_lossy(&bytes)), None)
                }
                Ok(None) => Outcome::NotFound,
                Err(e) => Outcome::Error(e),
            }
        })
    }
}

// ---------- LRCLIB ----------

pub struct Lrclib;
impl Lrclib {
    /// A record → lyrics, if it's the playing song (synced preferred; instrumental: nothing).
    fn record(req: &Request, v: &Value) -> Option<super::model::Lyrics> {
        let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("");
        if v.get("instrumental").and_then(Value::as_bool) == Some(true)
            || !titles_match(&req.title, s("trackName"))
            || !artists_match(&req.artist, s("artistName"))
            || !duration_ok(req.duration_sec, v.get("duration").and_then(Value::as_f64))
        {
            return None;
        }
        parse::parse_lrc(s("syncedLyrics")).filter(|l| l.synced).or_else(|| super::model::Lyrics::plain(s("plainLyrics")))
    }
}
impl Source for Lrclib {
    fn id(&self) -> &'static str {
        "lrclib"
    }
    fn fetch<'a>(&'a self, http: &'a Client, req: &'a Request) -> Fetch<'a> {
        Box::pin(async move {
            // The exact lookup first; the search when it has nothing (another album name, a slightly different title).
            match json(http.get("https://lrclib.net/api/get").query(&query(req, ["track_name", "artist_name", "album_name", "duration"]))).await {
                Ok(Some(v)) => {
                    if let Some(l) = Self::record(req, &v) {
                        return found(Some(l), None);
                    }
                }
                Ok(None) => {}
                Err(e) => return Outcome::Error(e),
            }
            let q = [("track_name", req.title.as_str()), ("artist_name", req.artist.as_str())];
            match json(http.get("https://lrclib.net/api/search").query(&q)).await {
                Ok(Some(Value::Array(list))) => {
                    let mut best = None;
                    for v in &list {
                        if let Some(l) = Self::record(req, v) {
                            if l.synced {
                                return found(Some(l), None);
                            }
                            best.get_or_insert(l);
                        }
                    }
                    found(best, None)
                }
                Ok(_) => Outcome::NotFound,
                Err(e) => Outcome::Error(e),
            }
        })
    }
}

#[cfg(test)]
mod live {
    use super::*;
    use crate::lyrics::model::Request;

    /// Hits the real services: `cargo test --lib lyrics::providers::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn every_provider_against_a_known_song() {
        let http = Client::builder().user_agent("ytdesk/test (+https://github.com/opecko/ytdesk)").build().unwrap();
        let req = Request {
            video_id: "PvM79DJ2PmM".into(),
            title: "The Less I Know the Better".into(),
            artist: "Tame Impala".into(),
            album: Some("Currents".into()),
            duration_sec: Some(216.0),
        };
        tauri::async_runtime::block_on(async {
            for s in SOURCES {
                let t = std::time::Instant::now();
                let out = s.fetch(&http, &req).await;
                let detail = match &out {
                    Outcome::Found { lyrics, source } => format!("{} lines, words: {}, source: {source:?}", lyrics.lines.len(), lyrics.lines.iter().any(|l| !l.words.is_empty())),
                    Outcome::Error(e) => e.clone(),
                    _ => String::new(),
                };
                println!("{:<13} {:<9} {:>5} ms  {detail}", s.id(), out.label(), t.elapsed().as_millis());
            }
            // A different recording (slowed + reverb, 253 s) must not match.
            let wrong = Request { duration_sec: Some(253.0), ..req.clone() };
            for s in SOURCES.iter().filter(|s| s.id() != "youtube") {
                let out = s.fetch(&http, &wrong).await;
                println!("wrong length: {:<13} {} {:?}", s.id(), out.label(), if let Outcome::Error(e) = &out { e.as_str() } else { "" });
            }
        });
    }
}
