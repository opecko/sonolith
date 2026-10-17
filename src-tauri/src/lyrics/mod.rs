//! Synced lyrics from several providers (YouTube Music, Better Lyrics, Unison, LyricsPlus, KuGou, LRCLIB): all
//! enabled ones are asked in parallel (4 s each, KuGou 7 s), the user's order decides (select.rs), results are cached per
//! video id (cache.rs). Requests come from here, not the webview: no CORS, one HTTP client.

mod cache;
mod matching;
pub mod model;
mod parse;
mod providers;
mod select;

use cache::{Cache, Cached};
use model::{Lyrics, Request};
use select::{decide, Decision, Outcome};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_http::reqwest::Client;
use tokio::task::JoinSet;


pub struct LyricsState {
    http: Client,
    cache: Cache,
}

impl LyricsState {
    pub fn new(app: &AppHandle) -> Self {
        let ua = format!("ytdesk/{} (+https://github.com/opecko/ytdesk)", app.package_info().version);
        let http = Client::builder().user_agent(ua).timeout(Duration::from_secs(8)).build().unwrap_or_default();
        LyricsState { http, cache: Cache::new(app.path().app_cache_dir().ok().map(|d| d.join("lyrics"))) }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetArgs {
    #[serde(flatten)]
    req: Request,
    /// Enabled provider ids, highest priority first.
    providers: Vec<String>,
    /// Dev toolkit: ask everyone (no cache, no early stop) and report each provider.
    #[serde(default)]
    debug: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    provider: String,
    /// synced | unsynced | none | error | timeout | skipped (a higher one had already won)
    status: String,
    ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsResponse {
    provider: Option<String>,
    lyrics: Option<Lyrics>,
    /// Where the provider got them, when it says ("Musixmatch").
    source: Option<String>,
    cached: bool,
    attempts: Vec<Attempt>,
}

#[tauri::command]
pub async fn lyrics_get(state: State<'_, LyricsState>, args: GetArgs) -> Result<LyricsResponse, String> {
    let sources: Vec<_> = args.providers.iter().filter_map(|id| providers::source(id)).collect();
    let setup = sources.iter().map(|s| s.id()).collect::<Vec<_>>().join(",");
    if sources.is_empty() || args.req.video_id.is_empty() {
        return Ok(LyricsResponse { provider: None, lyrics: None, source: None, cached: false, attempts: Vec::new() });
    }
    if !args.debug {
        if let Some(c) = state.cache.get(&args.req.video_id, &setup) {
            return Ok(LyricsResponse { provider: c.provider, lyrics: c.lyrics, source: c.source, cached: true, attempts: Vec::new() });
        }
    }

    let mut set = JoinSet::new();
    for (i, src) in sources.iter().copied().enumerate() {
        let (http, req) = (state.http.clone(), args.req.clone());
        set.spawn(async move {
            let t = Instant::now();
            let out = tokio::time::timeout(src.timeout(), src.fetch(&http, &req)).await.unwrap_or(Outcome::Timeout);
            (i, out, t.elapsed().as_millis() as u64)
        });
    }
    let mut results: Vec<Option<Outcome>> = vec![None; sources.len()];
    let mut times: Vec<Option<u64>> = vec![None; sources.len()];
    let mut decision = Decision::Wait;
    while let Some(joined) = set.join_next().await {
        let Ok((i, out, ms)) = joined else { continue };
        results[i] = Some(out);
        times[i] = Some(ms);
        decision = decide(&results.iter().map(Option::as_ref).collect::<Vec<_>>());
        // The winner is known: lower providers can stop (the debug view waits for everyone).
        if !args.debug && decision != Decision::Wait {
            set.abort_all();
            break;
        }
    }
    if decision == Decision::Wait {
        decision = decide(&results.iter().map(|r| Some(r.as_ref().unwrap_or(&Outcome::Timeout))).collect::<Vec<_>>());
    }

    let attempts = sources
        .iter()
        .enumerate()
        .map(|(i, s)| Attempt {
            provider: s.id().to_string(),
            status: results[i].as_ref().map_or("skipped", Outcome::label).to_string(),
            ms: times[i].unwrap_or(0),
            error: match &results[i] {
                Some(Outcome::Error(e)) => Some(e.clone()),
                _ => None,
            },
        })
        .collect();
    let (provider, lyrics, source) = match decision {
        Decision::Pick(i) => match results[i].take() {
            Some(Outcome::Found { lyrics, source }) => (Some(sources[i].id().to_string()), Some(lyrics), source),
            _ => (None, None, None),
        },
        _ => (None, None, None),
    };
    // Errors and timeouts aren't "not found": only cache what every provider actually answered.
    let all_answered = results.iter().all(|r| matches!(r, None | Some(Outcome::Found { .. }) | Some(Outcome::NotFound)));
    if !args.debug && (lyrics.is_some() || all_answered) {
        state.cache.put(&args.req.video_id, &setup, Cached { provider: provider.clone(), lyrics: lyrics.clone(), source: source.clone() });
    }
    Ok(LyricsResponse { provider, lyrics, source, cached: false, attempts })
}

/// Dev toolkit / settings: forget every cached result.
#[tauri::command]
pub fn lyrics_clear_cache(state: State<'_, LyricsState>) {
    state.cache.clear();
}
