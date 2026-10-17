//! Synced lyrics from several providers (YouTube Music, Better Lyrics, Unison, LyricsPlus, KuGou, LRCLIB): all
//! enabled ones are asked in parallel (4 s each, KuGou 7 s); the best answer so far goes out as it arrives (word-synced,
//! then line-synced, then unsynced; the user's order within a tier, select.rs), results are cached per
//! video id (cache.rs). Requests come from here, not the webview: no CORS, one HTTP client.

mod cache;
mod matching;
pub mod model;
mod parse;
mod providers;
mod select;

use cache::{Cache, Cached};
use model::{Lyrics, Request};
use select::{decide, Outcome};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
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
    /// word-synced | line-synced | unsynced | none | error | timeout | skipped (the answer was settled without it)
    status: String,
    ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize, Clone)]
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
pub async fn lyrics_get(state: State<'_, LyricsState>, args: GetArgs, on_update: Channel<LyricsResponse>) -> Result<LyricsResponse, String> {
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
    let mut shown: Option<usize> = None;
    let answer = |i: usize, results: &[Option<Outcome>]| match &results[i] {
        Some(Outcome::Found { lyrics, source }) => (Some(sources[i].id().to_string()), Some(lyrics.clone()), source.clone()),
        _ => (None, None, None),
    };
    while let Some(joined) = set.join_next().await {
        let Ok((i, out, ms)) = joined else { continue };
        results[i] = Some(out);
        times[i] = Some(ms);
        let d = decide(&results.iter().map(Option::as_ref).collect::<Vec<_>>());
        // A better answer than the one already sent: the view upgrades in place.
        if d.best != shown {
            if let Some(b) = d.best {
                let (provider, lyrics, source) = answer(b, &results);
                let _ = on_update.send(LyricsResponse { provider, lyrics, source, cached: false, attempts: Vec::new() });
            }
            shown = d.best;
        }
        // Nothing still running can beat the best: lower providers can stop (the debug view waits for everyone).
        if !args.debug && d.settled {
            set.abort_all();
            break;
        }
    }

    let best = decide(&results.iter().map(|r| Some(r.as_ref().unwrap_or(&Outcome::Timeout))).collect::<Vec<_>>()).best;
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
    let (provider, lyrics, source) = best.map_or((None, None, None), |b| answer(b, &results));
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
